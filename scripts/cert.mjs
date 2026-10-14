// HTTPS for the laptop node, so phones can install the app for offline use.
// Uses mkcert (brew install mkcert). Run once per network: the certificate
// names this laptop's current Wi-Fi address and its .local name.
//   npm run cert
import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync } from "node:fs";
import { hostname, networkInterfaces } from "node:os";
import { join } from "node:path";

function mkcert(args) {
    try {
        return execFileSync("mkcert", args, { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();
    } catch (e) {
        if (e.code === "ENOENT") {
            console.error("mkcert isn't installed. Run: brew install mkcert");
            process.exit(1);
        }
        throw e;
    }
}

const ips = Object.values(networkInterfaces()).flat()
    .filter(a => a && a.family === "IPv4" && !a.internal).map(a => a.address);
const local = hostname().replace(/\.local$/, "") + ".local";
const names = ["localhost", "127.0.0.1", local, ...ips];

mkdirSync("certs", { recursive: true });
mkcert(["-cert-file", "certs/cert.pem", "-key-file", "certs/key.pem", ...names]);
const caroot = mkcert(["-CAROOT"]);
// the node hands this file to phones at /ca.pem so they can trust the certificate
copyFileSync(join(caroot, "rootCA.pem"), "certs/rootCA.pem");

console.log(`\nCertificate made for: ${names.join(", ")}`);
console.log("\nOn each phone, once:");
console.log("  1. AirDrop certs/rootCA.pem to the phone (easiest), or with the node running open");
console.log(`     http://${ips[0] ?? local}:8081/ca.pem  (if Safari warns about the connection, tap Show Details → visit this website)`);
console.log("  2. iPhone: Settings → Profile Downloaded → Install. Then Settings → General → About →");
console.log("     Certificate Trust Settings → turn on full trust for the mkcert root.");
console.log("     Android: Settings → Security → Encryption & credentials → Install a certificate → CA certificate.");
console.log(`  3. Open https://${ips[0] ?? local}:8080 and add it to the home screen.\n`);
console.log("This laptop's own browser: run `mkcert -install` once to trust it here too.\n");
console.log("Changed Wi-Fi? Run npm run cert again (the address is part of the certificate).\n");
