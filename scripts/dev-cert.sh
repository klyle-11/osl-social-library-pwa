#!/usr/bin/env sh
# Makes a local certificate authority + a server certificate for testing on
# phones over your Wi-Fi. For the real archive node use a Let's Encrypt
# certificate via DNS-01 instead (see README) - phones trust that with no setup.
#
#   sh scripts/dev-cert.sh                      # localhost + this machine's LAN IPs
#   sh scripts/dev-cert.sh library.example.org  # also add a hostname
#
# Output (certs/):
#   ca.pem / ca.der   install + trust this on each test phone (once)
#   cert.pem key.pem  give these to the server (TLS_CERT / TLS_KEY)
set -e
cd "$(dirname "$0")/.."
mkdir -p certs
cd certs

SAN="DNS:localhost,IP:127.0.0.1"
for ip in $( (hostname -I 2>/dev/null || ipconfig getifaddr en0 2>/dev/null || true) ); do
  case "$ip" in *:*) ;; *) SAN="$SAN,IP:$ip" ;; esac
done
for name in "$@"; do SAN="$SAN,DNS:$name"; done
echo "Certificate names: $SAN"

if [ ! -f ca.pem ]; then
  openssl req -x509 -new -nodes -newkey rsa:2048 -keyout ca-key.pem -out ca.pem \
    -days 825 -subj "/CN=OSL Dev CA" \
    -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign"
  openssl x509 -in ca.pem -outform der -out ca.der
fi

# iOS rejects server certs valid for more than 825 days, and requires SAN + serverAuth.
# EC P-256 key: TLS handshakes are much faster on the ESP32 drop point than with RSA.
openssl req -new -nodes -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -keyout key.pem -out server.csr -subj "/CN=OSL node"
printf "subjectAltName=%s\nextendedKeyUsage=serverAuth\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\n" "$SAN" > ext.cnf
openssl x509 -req -in server.csr -CA ca.pem -CAkey ca-key.pem -CAcreateserial \
  -out cert.pem -days 397 -sha256 -extfile ext.cnf
rm -f server.csr ext.cnf

echo
echo "Done. Start with:  npm run start:https"
echo "Then trust certs/ca.pem on each phone (see README: 'Testing on phones')."
