// The steward's library: turns library/documents.json (+ files in library/files/)
// into dist/library.json, which every phone loads on launch - even with no node
// (demo mode, GitHub Pages). Run by `npm run build`.
//
// - Entries with "file" become items backed by a media file (hash, fileType, name).
// - Entries with "url" become link items.
// - Ids are stored on phones forever, so never change or reuse a document's id.
//   A new entry without an id gets the next "steward:<n>" written back to documents.json.
// - Collections are add-only here: adding a document to one works, removing does not.
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { validateOp, MEDIUMS } from "../src/contract.js";

const STEWARD = "steward";
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LIB = path.join(ROOT, "library");
const LIST = path.join(LIB, "documents.json");
const OUT = path.join(ROOT, "dist", "library.json");

const TYPES = {
    ".pdf": "application/pdf",
    ".epub": "application/epub+zip",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4",
};

const seqOf = (id) => Number(String(id).split(":").pop()) || 0;

const list = JSON.parse(fs.readFileSync(LIST, "utf8"));
const documents = list.documents || [];
const collections = list.collections || [];

let next = Math.max(0, ...documents.map((d) => seqOf(d.id))) + 1;
let assigned = false;
for (const d of documents) {
    if (!d.id) (d.id = `${STEWARD}:${next++}`), (assigned = true);
    if (!d.added) (d.added = new Date().toISOString().replace(/\.\d+Z$/, "Z")), (assigned = true);
}
if (assigned) fs.writeFileSync(LIST, JSON.stringify(list, null, 2) + "\n");

const ops = [];
/** hash -> { path, type }: where the app fetches each file to put it in the offline media cache */
const files = {};

for (const d of documents) {
    const properties = { title: d.title || "Untitled", author: d.author || "", type: MEDIUMS.includes(d.type) ? d.type : "" };
    for (const k of ["subtitle", "year", "description"]) if (d[k]) properties[k] = d[k];
    const op = { id: d.id, type: "item", author: STEWARD, created: d.added, properties };
    if (d.file) {
        const file = path.join(LIB, "files", d.file);
        if (!fs.existsSync(file)) {
            console.warn(`library: missing library/files/${d.file}, skipped`);
            continue;
        }
        op.hash = "sha256-" + crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex");
        op.name = d.file;
        op.fileType = TYPES[path.extname(d.file).toLowerCase()] || "application/octet-stream";
        files[op.hash] = { path: "library/files/" + encodeURIComponent(d.file), type: op.fileType };
    } else if (d.url) {
        op.url = d.url;
    }
    ops.push(op);
}

// Collection op ids are derived from the slug and document ids, so they stay stable between builds.
for (const c of collections) {
    const target = `${STEWARD}/${c.slug}`;
    const prefix = `${STEWARD}-${c.slug}`;
    ops.push({ id: `${prefix}:0`, type: "name-collection", author: STEWARD, created: c.added, target, name: c.name });
    for (const item of c.documents || []) {
        ops.push({ id: `${prefix}:${seqOf(item)}`, type: "add-to-collection", author: STEWARD, created: c.added, target, item });
    }
}

for (const op of ops) {
    const err = validateOp(op);
    if (err) throw new Error(`library: ${op.id}: ${err}`);
}

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({ ops, files }) + "\n");
console.log(`library: ${documents.length} documents, ${collections.length} collections -> dist/library.json`);
