# Networking Primer for Cybersecurity
### For Software Developers

---

## 1. Why Networking Matters for Security

Every exploit, every data breach, every lateral movement through a corporate network — it all rides on networking primitives. As a developer, you already understand abstractions. Security requires you to understand what's *under* those abstractions: the raw bytes on the wire, the handshakes your HTTP library hides from you, the trust assumptions baked into protocols designed in the 1980s.

This primer covers networking from the ground up, with a security lens on every layer.

---

## 2. The OSI Model — Actually Useful This Time

You've probably seen the OSI model in a textbook and forgotten it. Here's why it matters for security: **attacks target specific layers**, and defenses must match.

```
Layer 7 — Application    SQL injection, XSS, API abuse
Layer 6 — Presentation   TLS/SSL attacks, encoding tricks
Layer 5 — Session         Session hijacking, cookie theft
Layer 4 — Transport       SYN floods, port scanning
Layer 3 — Network         IP spoofing, routing attacks
Layer 2 — Data Link       ARP spoofing, MAC flooding
Layer 1 — Physical        Cable tapping, rogue access points
```

In practice, the **TCP/IP model** (4 layers) is what you'll work with daily:

```
Application    (OSI 5-7)    HTTP, DNS, SMTP, SSH
Transport      (OSI 4)      TCP, UDP
Internet       (OSI 3)      IP, ICMP, ARP*
Link           (OSI 1-2)    Ethernet, Wi-Fi
```

*ARP technically bridges layers 2-3, which is part of why it's so exploitable.

### Security Insight

Firewalls operate at different layers. A **packet filter** works at layers 3-4 (IP addresses and ports). A **WAF** (Web Application Firewall) works at layer 7 (HTTP content). Understanding the layer tells you what information is available for inspection and what can be spoofed.

---

## 3. IP Addressing and Subnetting

### IPv4 Fundamentals

An IPv4 address is a 32-bit number, written as four octets: `192.168.1.42`. As a developer, think of it as a `uint32` rendered in a human-friendly format.

```python
# An IP address is just a number
import struct, socket

ip_str = "192.168.1.42"
ip_packed = socket.inet_aton(ip_str)        # b'\xc0\xa8\x01\x2a'
ip_int = struct.unpack("!I", ip_packed)[0]  # 3232235818

# And back
socket.inet_ntoa(struct.pack("!I", ip_int)) # '192.168.1.42'
```

### Subnet Masks and CIDR

A subnet mask divides the IP into a **network portion** and a **host portion**. `192.168.1.0/24` means the first 24 bits identify the network, the last 8 bits identify the host.

```
IP:       192.168.1.42    = 11000000.10101000.00000001.00101010
Mask:     255.255.255.0   = 11111111.11111111.11111111.00000000
                            |-------- network --------|- host -|
Network:  192.168.1.0     = IP AND Mask
Broadcast:192.168.1.255   = IP OR (NOT Mask)
```

Common CIDR blocks you'll encounter:

```
/32  — single host (1 address)
/24  — 256 addresses (254 usable), classic "Class C"
/16  — 65,536 addresses, common for corporate LANs
/8   — 16.7M addresses
```

### Private (RFC 1918) Address Ranges

These never appear on the public internet and are critical to understand for internal network security:

```
10.0.0.0/8        — large enterprise networks
172.16.0.0/12     — medium networks (172.16.0.0 – 172.31.255.255)
192.168.0.0/16    — home/small office networks
```

### Security Insight

When you see traffic from `10.x.x.x` arriving at a public-facing interface, something is wrong — either spoofed source addresses or a misconfigured network. This is the basis of **ingress filtering** (BCP 38). Also, understanding subnetting is essential for network segmentation — the primary defense against lateral movement after an initial compromise.

### IPv6 — The Brief Version

128-bit addresses, written as eight groups of four hex digits: `2001:0db8:85a3:0000:0000:8a2e:0370:7334`. Leading zeros can be dropped, and one run of all-zero groups can be replaced with `::`.

Security relevance: many networks have IPv6 enabled but not monitored, creating a blind spot. Dual-stack hosts can be attacked via whichever protocol has weaker controls.

---

## 4. TCP — The Protocol You Use Every Day Without Thinking

### The Three-Way Handshake

Every TCP connection your code opens (HTTP requests, database connections, etc.) starts with this:

```
Client                    Server
  |--- SYN (seq=x) -------->|     "I want to talk"
  |<-- SYN-ACK (seq=y, -----| 	   "OK, I'm listening"
  |         ack=x+1)        |
  |--- ACK (ack=y+1) ------>|     "Great, let's go"
  |                          |
  |<===== data flows =======>|
```

### TCP Header (20 bytes minimum)

```
 0                   1                   2                   3
 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1 2 3 4 5 6 7 8 9 0 1
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Source Port          |       Destination Port        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                        Sequence Number                        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|                    Acknowledgment Number                      |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
| Offset|  Res  |C|E|U|A|P|R|S|F|           Window             |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|           Checksum            |         Urgent Pointer        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

The **flags** (CWR, ECE, URG, ACK, PSH, RST, SYN, FIN) are where the security action is:

- **SYN** — connection initiation. A SYN flood sends millions of these without completing the handshake, exhausting server resources.
- **RST** — forcible connection reset. An attacker who can inject a RST packet can kill any TCP connection.
- **FIN** — graceful close. Unusual flag combinations (SYN+FIN, no flags at all) are used by port scanners like Nmap to fingerprint operating systems.

### TCP States and Security

```
LISTEN → SYN_RECEIVED → ESTABLISHED → FIN_WAIT → CLOSED
```

The `SYN_RECEIVED` state is where SYN flood attacks cause damage — the server allocates resources for a half-open connection that the attacker never completes. **SYN cookies** are the kernel-level defense: the server encodes state in the sequence number itself, avoiding resource allocation until the handshake completes.

### Port Numbers

Ports are 16-bit unsigned integers (0–65535):

```
0-1023       Well-known ports (require root/admin on Unix)
1024-49151   Registered ports
49152-65535  Ephemeral (dynamic) ports — your OS picks these for outbound connections
```

Key ports for security work:

```
20/21  FTP (cleartext credentials — never use)
22     SSH (your secure remote access lifeline)
23     Telnet (cleartext everything — legacy only)
25     SMTP (email, often exploited for spam/phishing)
53     DNS (both TCP and UDP — critical attack surface)
80     HTTP
110    POP3
143    IMAP
443    HTTPS
445    SMB (Windows file sharing — WannaCry, EternalBlue)
3389   RDP (Remote Desktop — frequently brute-forced)
8080   HTTP alternate (common for proxies and dev servers)
```

### Seeing It in Practice

As a developer, you can observe all of this with tools you probably already have:

```bash
# Watch the three-way handshake in real time
sudo tcpdump -i any -n 'tcp[tcpflags] & (tcp-syn|tcp-fin) != 0' -c 20

# See all listening ports on your machine
ss -tlnp          # Linux
netstat -tlnp     # older Linux
lsof -i -P -n    # macOS

# Capture full packets for analysis in Wireshark
sudo tcpdump -i eth0 -w capture.pcap -c 1000
```

---

## 5. UDP — The "Throw It and Forget It" Protocol

UDP has no handshake, no acknowledgments, no ordering guarantees. Its header is just 8 bytes:

```
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|          Source Port          |       Destination Port        |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
|            Length             |           Checksum            |
+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+-+
```

### Why Security Cares About UDP

1. **Source IP spoofing is trivial** — there's no handshake to prove the sender is who they claim. This enables **amplification attacks**: send a small request to a DNS server with a spoofed source IP, and the server sends a large response to the victim.

2. **DNS runs on UDP** (port 53), making it a prime attack vector. DNS cache poisoning, DNS tunneling (exfiltrating data through DNS queries), and DNS amplification DDoS all exploit UDP's trust model.

3. **No connection state** means firewalls can't track UDP "connections" the same way they track TCP. Stateful firewalls use heuristics (matching source/dest pairs with timeouts) to handle UDP.

```python
# UDP is dead simple — which is exactly the problem
import socket

sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
sock.sendto(b"Hello", ("192.168.1.1", 9999))
# No handshake. No confirmation. The packet may or may not arrive.
# The source IP in the IP header? The kernel filled it in,
# but a raw socket could put anything there.
```

---

## 6. DNS — The Internet's Phone Book (and Attack Surface)

### How DNS Resolution Works

When your code calls `requests.get("https://example.com")`, here's what actually happens:

```
1. Check /etc/hosts (or Windows hosts file)
2. Check local DNS cache
3. Query configured DNS resolver (e.g., 8.8.8.8)
4. Resolver queries root nameserver → "Who handles .com?"
5. Resolver queries .com TLD server → "Who handles example.com?"
6. Resolver queries example.com's authoritative nameserver
7. Gets the A record (IPv4) or AAAA record (IPv6)
8. Caches the result based on TTL
```

### DNS Record Types You'll Encounter

```
A       IPv4 address                  example.com → 93.184.216.34
AAAA    IPv6 address                  example.com → 2606:2800:220:1:...
CNAME   Alias to another domain       www.example.com → example.com
MX      Mail server                   example.com → mail.example.com
NS      Nameserver                    example.com → ns1.example.com
TXT     Arbitrary text                SPF, DKIM, domain verification
PTR     Reverse lookup (IP → name)    93.184.216.34 → example.com
SOA     Zone authority info           Serial numbers, refresh intervals
SRV     Service location              _sip._tcp.example.com → ...
```

### DNS Security Attacks

**DNS Spoofing / Cache Poisoning**: An attacker races to respond to a DNS query before the legitimate server does. If they win, the resolver caches the attacker's answer, redirecting all users to a malicious IP. The Kaminsky attack (2008) made this catastrophically easy by exploiting predictable transaction IDs.

**DNS Tunneling**: Encoding data in DNS queries to exfiltrate information through firewalls. Since most firewalls allow DNS traffic (port 53), this creates a covert channel. Tools like `iodine` and `dnscat2` automate this.

```bash
# Reconnaissance with DNS
dig example.com ANY              # All records
dig -x 93.184.216.34             # Reverse lookup
dig example.com AXFR @ns1.example.com  # Zone transfer (if misconfigured)
host -t mx example.com           # Mail servers
nslookup -type=txt example.com   # TXT records (SPF, DKIM)
```

**DNSSEC** adds cryptographic signatures to DNS responses, preventing spoofing. Adoption is still incomplete.

---

## 7. ARP — The Trusting Protocol

ARP (Address Resolution Protocol) maps IP addresses to MAC addresses on a local network. It operates on blind trust, which is a fundamental security weakness.

```
"Who has 192.168.1.1? Tell 192.168.1.42"     → ARP Request (broadcast)
"192.168.1.1 is at aa:bb:cc:dd:ee:ff"        → ARP Reply (unicast)
```

### ARP Spoofing (ARP Poisoning)

Any device on the local network can send unsolicited ARP replies. An attacker sends:

```
"192.168.1.1 (the gateway) is at [attacker's MAC]"
```

Now all traffic destined for the gateway flows through the attacker — a classic **man-in-the-middle** position. From here, the attacker can sniff traffic, modify packets in transit, or selectively drop connections.

```bash
# See your ARP table
arp -a

# Watch ARP traffic (useful for detecting spoofing)
sudo tcpdump -i eth0 arp
```

**Defense**: Dynamic ARP Inspection (DAI) on managed switches, static ARP entries for critical infrastructure, and encrypted protocols (TLS) to limit what an attacker gains from MITM position.

---

## 8. HTTP/HTTPS — Where Most Modern Attacks Happen

You know HTTP as a developer. Here's the security angle.

### HTTP Request Anatomy

```
GET /api/users?id=42 HTTP/1.1        ← Method, path, version
Host: example.com                     ← Required in HTTP/1.1
Authorization: Bearer eyJhbGc...      ← Authentication token
Cookie: session=abc123                ← Session state
User-Agent: Mozilla/5.0               ← Client identification
Accept: application/json              ← Content negotiation
X-Forwarded-For: 10.0.0.1            ← Proxy chain (spoofable!)
```

### Security-Relevant Headers

```
# Response headers that defend against attacks
Strict-Transport-Security: max-age=31536000; includeSubDomains  # Force HTTPS
Content-Security-Policy: default-src 'self'                      # Prevent XSS
X-Content-Type-Options: nosniff                                  # Prevent MIME sniffing
X-Frame-Options: DENY                                            # Prevent clickjacking
Set-Cookie: session=abc; Secure; HttpOnly; SameSite=Strict       # Cookie hardening
```

### TLS (Transport Layer Security)

TLS is what puts the S in HTTPS. The handshake (TLS 1.3 simplified):

```
Client                         Server
  |--- ClientHello ------------->|    Supported cipher suites, random
  |<-- ServerHello, Certificate -|    Chosen suite, server's certificate
  |    + Key Share               |    ECDHE public key
  |--- Key Share, Finished ----->|    Client's ECDHE public key
  |<-- Finished -----------------|
  |                              |
  |<=== encrypted data =========>|    Symmetric encryption with derived keys
```

Key concepts for security:

- **Certificate validation**: Your browser/code checks that the server's certificate is signed by a trusted Certificate Authority (CA), not expired, and matches the domain. **Certificate pinning** goes further by only trusting specific certificates.
- **Forward secrecy**: Ephemeral Diffie-Hellman (ECDHE) means that even if the server's private key is later compromised, past sessions can't be decrypted.
- **Cipher suites**: The negotiated combination of key exchange, bulk encryption, and MAC algorithms. Weak suites (RC4, DES, export ciphers) are active vulnerabilities.

```bash
# Inspect a server's TLS configuration
openssl s_client -connect example.com:443 -tls1_3
nmap --script ssl-enum-ciphers -p 443 example.com

# Check certificate details
echo | openssl s_client -connect example.com:443 2>/dev/null | openssl x509 -text -noout
```

---

## 9. Network Architecture and Segmentation

### The Classic Network Zones

```
┌──────────────────────────────────────────────────────┐
│                     INTERNET                          │
└──────────────┬───────────────────────────────────────┘
               │
        ┌──────┴──────┐
        │  Firewall    │
        └──────┬──────┘
               │
    ┌──────────┴──────────┐
    │        DMZ           │   Web servers, mail servers
    │   (Demilitarized     │   Public-facing services
    │       Zone)          │   Limited trust
    └──────────┬──────────┘
               │
        ┌──────┴──────┐
        │  Firewall    │       (or firewall rules)
        └──────┬──────┘
               │
    ┌──────────┴──────────┐
    │   Internal Network   │   Workstations, internal apps
    │                      │   Databases, file servers
    └─────────────────────┘
```

### VLANs (Virtual LANs)

VLANs segment a physical network into isolated broadcast domains. A switch port assigned to VLAN 10 can only talk to other VLAN 10 ports — traffic between VLANs must go through a router (where firewall rules can be applied).

**VLAN hopping** is an attack where an attacker escapes their VLAN by exploiting trunk port misconfiguration (802.1Q double-tagging). Defense: disable unused ports, use a dedicated native VLAN, and never use VLAN 1 for user traffic.

### Zero Trust Architecture

The modern security model abandons the "hard shell, soft interior" approach. Instead:

- No implicit trust based on network location
- Every request is authenticated and authorized
- Microsegmentation limits blast radius
- Continuous verification, not one-time authentication

As a developer, you've probably already encountered this through OAuth2/OIDC, mutual TLS (mTLS) between services, and service meshes like Istio.

---

## 10. NAT, Proxies, and VPNs

### NAT (Network Address Translation)

Your home router translates your private IPs (`192.168.1.x`) to its single public IP. It tracks the mapping in a **NAT table**:

```
Internal              External             Remote
192.168.1.42:54321 →  203.0.113.5:54321 →  93.184.216.34:443
192.168.1.43:49876 →  203.0.113.5:49876 →  93.184.216.34:443
```

Security implications: NAT provides obscurity (internal IPs hidden) but not security. It breaks end-to-end connectivity, complicating protocols like SIP, FTP, and peer-to-peer applications. NAT traversal techniques (STUN, TURN, ICE) create additional attack surface.

### Proxies

**Forward proxy**: Sits between clients and the internet. Used for content filtering, caching, and anonymization. Clients know about it and configure their traffic to go through it.

**Reverse proxy**: Sits between the internet and servers. Clients don't know it exists. Used for load balancing, TLS termination, and WAF functionality. Nginx, HAProxy, Cloudflare — you've worked with these.

**Transparent proxy**: Intercepts traffic without client configuration. Common in corporate environments for monitoring. This is why your HTTPS traffic at work might have a certificate signed by your company's CA instead of Let's Encrypt.

### VPNs

VPNs create encrypted tunnels between networks or between a client and a network.

```
[Your Device] ←—encrypted tunnel—→ [VPN Server] ←—normal traffic—→ [Internet]
```

Types you'll encounter: **IPsec** (layer 3, common in enterprise site-to-site), **WireGuard** (modern, fast, minimal code surface), **OpenVPN** (TLS-based, widely deployed).

Security caveat: A VPN protects traffic in transit but doesn't protect against a compromised endpoint. Corporate VPNs also create a fat trust boundary — once you're on the VPN, you often have broad network access, which is why zero trust is replacing traditional VPN architectures.

---

## 11. ICMP and Network Reconnaissance

ICMP (Internet Control Message Protocol) carries error and diagnostic messages. `ping` and `traceroute` use ICMP.

```bash
# Ping — ICMP Echo Request / Echo Reply
ping -c 4 example.com

# Traceroute — maps the path packets take
traceroute example.com      # Uses UDP on Linux, ICMP on Windows (tracert)
mtr example.com             # Combines ping + traceroute, continuous

# ICMP types relevant to security
Type 0  — Echo Reply
Type 3  — Destination Unreachable (subtypes reveal firewall behavior)
Type 8  — Echo Request
Type 11 — Time Exceeded (used by traceroute)
```

### Security Relevance

- **ICMP tunneling**: Encoding data in ICMP echo payloads to bypass firewalls (tools: `ptunnel`, `icmpsh`).
- **Ping of Death**: Historically, oversized ICMP packets crashed systems. Modern stacks are patched, but variants resurface.
- **ICMP-based reconnaissance**: Ping sweeps identify live hosts. The specific "Destination Unreachable" subtypes reveal whether a port is filtered (firewall silently drops) vs. closed (host responds with RST).

Many security-hardened networks block ICMP entirely, which breaks `ping` and `traceroute` but eliminates these attack vectors.

---

## 12. Firewalls, IDS/IPS, and Network Security Devices

### Firewall Types

**Packet filter** (stateless): Examines individual packets against rules based on source/dest IP, ports, protocol. Fast but can't understand connections.

**Stateful firewall**: Tracks TCP connection state. Knows that an inbound packet on port 54321 is a response to an outbound request, not an unsolicited connection. This is what `iptables`/`nftables` do by default.

**Application-layer firewall / WAF**: Inspects HTTP payloads for SQL injection, XSS, command injection patterns. ModSecurity, AWS WAF, Cloudflare.

```bash
# iptables basics — you'll encounter these in CTFs and real work
# Allow established connections
iptables -A INPUT -m state --state ESTABLISHED,RELATED -j ACCEPT

# Allow SSH
iptables -A INPUT -p tcp --dport 22 -j ACCEPT

# Allow HTTP/HTTPS
iptables -A INPUT -p tcp --dport 80 -j ACCEPT
iptables -A INPUT -p tcp --dport 443 -j ACCEPT

# Drop everything else
iptables -A INPUT -j DROP

# Modern alternative: nftables
nft add rule inet filter input tcp dport 22 accept
```

### IDS vs IPS

**IDS** (Intrusion Detection System): Monitors traffic passively. Alerts on suspicious patterns. Snort, Suricata, Zeek (formerly Bro).

**IPS** (Intrusion Prevention System): Same analysis but sits inline and can **block** malicious traffic in real time. Higher risk of false positives disrupting legitimate traffic.

Both use **signature-based** detection (known attack patterns) and **anomaly-based** detection (statistical deviations from baseline behavior).

---

## 13. Wireless Networking (802.11)

### Security Evolution

```
WEP  (1997)  — Broken. RC4 with static keys. Crackable in minutes.
WPA  (2003)  — TKIP. Stopgap. Also broken (Beck-Tews attack).
WPA2 (2004)  — AES-CCMP. Solid, but vulnerable to KRACK (2017) and
               offline dictionary attacks against PSK.
WPA3 (2018)  — SAE (Simultaneous Authentication of Equals). Forward
               secrecy, protection against offline dictionary attacks.
```

### Common Wireless Attacks

- **Evil Twin**: Set up a fake AP with the same SSID as a legitimate network. Victims connect to you.
- **Deauthentication attack**: Send forged deauth frames to disconnect clients, forcing them to reconnect (potentially to your evil twin). This works because management frames in 802.11 are unauthenticated (fixed in 802.11w/WPA3).
- **WPA2 PSK cracking**: Capture the four-way handshake, then brute-force the passphrase offline with `hashcat` or `aircrack-ng`.
- **PMKID attack**: Extract the PMKID from the first message of the handshake — no need to wait for a full handshake or deauth clients.

```bash
# Wireless recon (requires monitor mode)
sudo airmon-ng start wlan0
sudo airodump-ng wlan0mon

# Capture handshake
sudo airodump-ng -c 6 --bssid AA:BB:CC:DD:EE:FF -w capture wlan0mon

# Crack with wordlist
aircrack-ng -w /usr/share/wordlists/rockyou.txt capture-01.cap
```

---

## 14. Essential Command-Line Tools

These are your daily instruments for network security work:

### Packet Capture and Analysis

```bash
# tcpdump — command-line packet analyzer
sudo tcpdump -i eth0 -n port 80          # HTTP traffic
sudo tcpdump -i any -A 'tcp port 80'     # Show ASCII payload
sudo tcpdump -i eth0 -w out.pcap         # Save for Wireshark

# tshark — Wireshark on the command line
tshark -i eth0 -Y 'http.request' -T fields -e http.host -e http.request.uri
```

### Network Scanning

```bash
# nmap — the Swiss Army knife
nmap -sn 192.168.1.0/24                  # Ping sweep (host discovery)
nmap -sS -p- 192.168.1.42               # SYN scan, all ports
nmap -sV -sC 192.168.1.42               # Version detection + default scripts
nmap -O 192.168.1.42                     # OS fingerprinting
nmap -sU -p 53,161,500 192.168.1.42     # UDP scan (slow)
nmap --script vuln 192.168.1.42          # Vulnerability scanning
```

### Network Diagnostics

```bash
# Connection investigation
ss -tlnp                     # Listening TCP sockets with process names
ss -s                        # Socket statistics summary
lsof -i :8080               # What process is using port 8080?

# DNS investigation
dig +short example.com       # Quick A record lookup
dig +trace example.com       # Full resolution path
dog example.com              # Modern alternative to dig

# HTTP investigation
curl -v https://example.com  # Verbose — shows TLS handshake, headers
curl -I https://example.com  # Headers only
```

### Traffic Interception (for authorized testing)

```bash
# mitmproxy — intercept and modify HTTPS traffic
mitmproxy                    # Interactive TUI
mitmdump -w traffic.flow     # Non-interactive capture
mitmweb                      # Web UI

# Burp Suite (GUI) — the industry standard for web app testing
# Community Edition is free, Professional for active scanning
```

---

## 15. Putting It Together: A Packet's Journey

Let's trace what happens when your browser navigates to `https://example.com/api/data`:

```
1. DNS Resolution (UDP/53)
   Your OS queries the configured resolver for example.com
   → Response: 93.184.216.34

2. TCP Handshake (Layer 4)
   SYN → SYN-ACK → ACK to 93.184.216.34:443
   Your OS picks an ephemeral source port (e.g., 52431)

3. TLS Handshake (Layer 6-7)
   ClientHello → ServerHello + Certificate → Key Exchange → Finished
   Both sides derive symmetric encryption keys

4. HTTP Request (Layer 7, encrypted)
   GET /api/data HTTP/1.1
   Host: example.com
   (encrypted inside TLS, invisible to network observers)

5. Routing (Layer 3)
   Your packet traverses: your NIC → router (NAT) → ISP → 
   backbone → destination network → load balancer → server

6. At Each Hop
   - Layer 2 headers (MAC addresses) change at every router
   - Layer 3 headers (IP addresses) stay the same*
   - Layer 4+ is untouched by routers
   
   *Unless NAT is involved, which rewrites the source IP

7. Response follows the reverse path
   Server → ... → your router (de-NAT) → your machine
   TCP ensures ordering and completeness
   TLS ensures confidentiality and integrity
```

An attacker at any point in this chain has different capabilities: on the local network, they can ARP spoof. On the path, they can observe metadata (IP addresses, packet sizes, timing) but not content (TLS). At the DNS level, they can redirect you entirely.

---

## 16. What to Learn Next

This primer gives you the foundation. Here's a progression for going deeper into security:

**Hands-on practice**: TryHackMe and Hack The Box have guided rooms for network security. Start with TryHackMe's "Pre-Security" and "Complete Beginner" paths.

**Wireshark mastery**: Download packet captures from Wireshark's sample library and practice filtering and analysis. Learn to spot anomalies in TCP streams, identify scanning patterns, and extract data from cleartext protocols.

**CTF competitions**: picoCTF, OverTheWire (Bandit → Natas → Narnia), and SANS Holiday Hack Challenge.

**Certifications** (if that's your path): CompTIA Security+ (broad foundation), CompTIA Network+ (deeper networking), eJPT (practical pentesting), OSCP (advanced, hands-on offensive security).

**Books**: "The TCP/IP Guide" by Charles Kozierok (exhaustive reference), "Practical Packet Analysis" by Chris Sanders (Wireshark-focused), "Network Security Assessment" by Chris McNab.

**Build things**: Set up a home lab with VMs — a pfSense firewall, a vulnerable machine (Metasploitable, DVWA), and an attack machine (Kali Linux). Break things in a safe environment.

---

*The best security professionals understand networks at the byte level. Your developer background gives you an enormous advantage — you already think in systems, abstractions, and edge cases. Now apply that thinking one layer down.*
