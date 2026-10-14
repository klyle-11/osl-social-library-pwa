// Plug documents in: drop files into library/files/, then run `npm run catalog`
// (npm start runs it for you).
//
// - Any new file gets an entry in library/documents.json with a title guessed
//   from its filename. Edit that entry (title, author, type, year, description,
//   alt) and run again.
// - Entries can also be links: { "url": "https://…", "title": "…" }.
// - Each document keeps its id forever once assigned: annotations point at it.
// - Output: library/catalog.json, the steward's document ops that every phone loads.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join } from "node:path";

const STEWARD = "steward";

const TYPES = {
    ".pdf": ["application/pdf", ""], ".epub": ["application/epub+zip", "book"],
    ".txt": ["text/plain", ""], ".md": ["text/plain", ""],
    ".jpg": ["image/jpeg", "photo"], ".jpeg": ["image/jpeg", "photo"], ".png": ["image/png", "photo"],
    ".gif": ["image/gif", "photo"], ".webp": ["image/webp", "photo"],
    ".mp3": ["audio/mpeg", "audio"], ".m4a": ["audio/mp4", "audio"], ".wav": ["audio/wav", "audio"],
    ".mp4": ["video/mp4", "film"], ".webm": ["video/webm", "film"]
};

function titleFromFile(name) {
    const base = name.slice(0, name.length - extname(name).length).replace(/[-_]+/g, " ").trim();
    return base.charAt(0).toUpperCase() + base.slice(1);
}

function seqOf(id) {
    const n = Number(String(id).split(":").pop());
    return Number.isInteger(n) ? n : 0;
}

export function buildCatalog(root = ".") {
    const lib = join(root, "library");
    const filesDir = join(lib, "files");
    const listPath = join(lib, "documents.json");
    const list = existsSync(listPath)
        ? JSON.parse(readFileSync(listPath, "utf8"))
        : { stewards: [STEWARD], documents: [], collections: [] };
    list.stewards ??= [STEWARD];
    list.documents ??= [];
    list.collections ??= [];

    const now = new Date().toISOString().replace(/\.\d+Z$/, "Z");
    let next = Math.max(0, ...list.documents.map(d => seqOf(d.id))) + 1;

    // new files -> new entries
    const known = new Set(list.documents.map(d => d.file).filter(Boolean));
    const files = existsSync(filesDir)
        ? readdirSync(filesDir).filter(f => !f.startsWith(".") && statSync(join(filesDir, f)).isFile()).sort()
        : [];
    let added = 0;
    for (const file of files) {
        if (known.has(file)) continue;
        const [, medium] = TYPES[extname(file).toLowerCase()] ?? ["", ""];
        list.documents.push({ file, title: titleFromFile(file), author: "", type: medium, year: "", description: "", alt: "" });
        added++;
    }
    // ids and dates are assigned once and then never change
    for (const d of list.documents) {
        if (!d.id) d.id = `${STEWARD}:${next++}`;
        if (!d.added) d.added = now;
    }
    for (const c of list.collections) if (!c.added) c.added = now;

    const ops = [];
    const missing = [];
    for (const d of list.documents) {
        const props = { title: d.title || "Untitled", author: d.author ?? "", type: d.type ?? "" };
        for (const k of ["subtitle", "year", "description", "alt"]) if (d[k]) props[k] = d[k];
        const op = { id: d.id, user: STEWARD, timestamp: d.added, type: "document", properties: props };
        if (d.file) {
            const path = join(filesDir, d.file);
            if (!existsSync(path)) { missing.push(d.file); continue; }
            op.url = "library/files/" + encodeURIComponent(d.file);
            op.fileType = (TYPES[extname(d.file).toLowerCase()] ?? ["application/octet-stream"])[0];
            op.hash = "sha256-" + createHash("sha256").update(readFileSync(path)).digest("hex");
        } else if (d.url) {
            op.url = d.url;
            op.fileType = "link";
        } else {
            op.fileType = "text";
        }
        ops.push(op);
    }

    // steward collections. Their op ids come after the documents' and may change
    // between runs; that's fine, because the catalog is never stored on phones.
    let cseq = next;
    for (const c of list.collections) {
        const collectionId = `${STEWARD}/${c.slug}`;
        ops.push({ id: `${STEWARD}:${cseq++}`, user: STEWARD, timestamp: c.added, type: "name-collection", collectionId, name: c.name });
        for (const docId of c.documents ?? []) {
            ops.push({ id: `${STEWARD}:${cseq++}`, user: STEWARD, timestamp: c.added, type: "add-to-collection", collectionId, documentId: docId });
        }
    }

    const listText = JSON.stringify(list, null, 2) + "\n";
    if (!existsSync(listPath) || readFileSync(listPath, "utf8") !== listText) writeFileSync(listPath, listText);
    writeFileSync(join(lib, "catalog.json"), JSON.stringify({ stewards: list.stewards, ops }, null, 2) + "\n");
    console.log(`catalog: ${list.documents.length - missing.length} documents${added ? ` (${added} new — edit library/documents.json to title them)` : ""}`);
    for (const f of missing) console.warn(`catalog: missing file library/files/${f} — skipped`);
    return { ops, stewards: list.stewards };
}

if (import.meta.url === `file://${process.argv[1]}`) buildCatalog();
