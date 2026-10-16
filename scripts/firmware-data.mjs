// Fills firmware/data/ for a drop point's flash (pio run -e droppoint-... -t uploadfs):
//   www/  the app, exactly as the library serves it (run after a build: npm run build:firmware)
//   tls/  cert.pem + key.pem, only when the firmware uses https (LIBRARY_HTTPS 1 in config.h)
// Library files (library/files), pdf.js (dist/vendor) and source maps stay out: the flash
// is small. PDFs live at the library, and a phone that carried one carried pdf.js with it.
//
// The drop point must carry the same build as the Pi (README, W-D10): build once, then
// copy this to the drop point and start the Pi from the same dist/ (node dist-node/server.mjs),
// or check that the version printed below matches the one the Pi prints.
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const out = "firmware/data";
const config = readFileSync("firmware/include/config.h", "utf8");
const https = /#define\s+LIBRARY_HTTPS\s+1\b/.test(config);

rmSync(out, { recursive: true, force: true });
cpSync("dist", join(out, "www"), {
    recursive: true,
    filter: src => !src.startsWith(join("dist", "library")) && !src.startsWith(join("dist", "vendor")) && !src.endsWith(".map")
});

if (https) {
    mkdirSync(join(out, "tls"), { recursive: true });
    const files = [[process.env.TLS_CERT ?? "certs/cert.pem", "cert.pem"], [process.env.TLS_KEY ?? "certs/key.pem", "key.pem"], ["certs/rootCA.pem", "ca.pem"]];
    for (const [from, to] of files) {
        if (existsSync(from)) cpSync(from, join(out, "tls", to));
        else if (to !== "ca.pem") console.warn(`missing ${from}: with LIBRARY_HTTPS 1 the drop point needs it`);
    }
}

const size = dir => readdirSync(dir, { withFileTypes: true })
    .reduce((n, e) => n + (e.isDirectory() ? size(join(dir, e.name)) : statSync(join(dir, e.name)).size), 0);
const kb = Math.round(size(out) / 1024);
const version = /osl-shell-([0-9a-f]+)/.exec(readFileSync("dist/sw.js", "utf8"))?.[1] ?? "?";
console.log(`firmware/data ready: ${kb} KB, app version ${version}${https ? ", https" : ", plain http at the Pi's address"}.`);
// the file system is 1.5 MB on the 8 MB boards and 896 KB on the LilyGO, and the op log shares it
if (kb > 600) console.warn("That leaves little room for the op log on a LilyGO (896 KB of flash file system).");
console.log("Next: cd firmware && pio run -e droppoint-xiao-s3 -t uploadfs   (uploadfs erases the op log: see firmware/README.md)");
