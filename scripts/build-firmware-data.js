// Fills firmware/data/ for the drop point's flash (pio run -e droppoint-... -t uploadfs):
//   www/  the built app (same files the archive serves)
//   tls/  cert.pem + key.pem for LIBRARY_DOMAIN (same as the archive), and ca.pem if testing with the dev CA
// Run after `npm run build:site`. Certificate paths: TLS_CERT / TLS_KEY, default certs/.
import fs from "node:fs";
import path from "node:path";

const out = "firmware/data";
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync("site", path.join(out, "www"), { recursive: true });
fs.rmSync(path.join(out, "www", "dist", "app.js.map"), { force: true }); // flash is small
fs.rmSync(path.join(out, "www", ".nojekyll"), { force: true });

const cert = process.env.TLS_CERT || "certs/cert.pem";
const key = process.env.TLS_KEY || "certs/key.pem";
fs.mkdirSync(path.join(out, "tls"), { recursive: true });
for (const [from, to] of [[cert, "cert.pem"], [key, "key.pem"], ["certs/ca.pem", "ca.pem"]]) {
    if (fs.existsSync(from)) fs.copyFileSync(from, path.join(out, "tls", to));
    else if (to !== "ca.pem") console.warn(`missing ${from}: the drop point needs it for HTTPS`);
}
const size = (dir) => fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? size(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
console.log(`firmware/data ready (${(size(out) / 1024).toFixed(0)} KB). Next: cd firmware && pio run -e droppoint-heltec-v3 -t uploadfs`);
