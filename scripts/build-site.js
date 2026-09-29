// Copies only the public app files into site/ for static hosting
// (Vercel, GitHub Pages). Run after `npm run build`.
import fs from "node:fs";

const files = ["index.html", "styles.css", "sw.js", "manifest.webmanifest", "icons", "dist"];
fs.rmSync("site", { recursive: true, force: true });
fs.mkdirSync("site");
for (const f of files) fs.cpSync(f, "site/" + f, { recursive: true });
fs.writeFileSync("site/.nojekyll", "");
console.log("site/ ready:", fs.readdirSync("site").join(", "));
