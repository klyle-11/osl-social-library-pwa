// Seed content for testing and the workshop: a few items, annotations and a
// collection, sent to a running node through the normal /sync endpoint.
// IDs are fixed ("seed:1", "seed:2", ...) so running it twice changes nothing.
//
//   node scripts/seed.js                         # http://localhost:8080
//   NODE_EXTRA_CA_CERTS=certs/ca.pem node scripts/seed.js https://localhost:8443

import fs from "node:fs";
import crypto from "node:crypto";
import { validateOp } from "../src/contract.js";

const base = (process.argv[2] || "http://localhost:8080").replace(/\/?$/, "/");

const photo = fs.readFileSync(new URL("../icons/icon-512.png", import.meta.url));
const photoHash = "sha256-" + crypto.createHash("sha256").update(photo).digest("hex");
const note = Buffer.from("Transcript of an oral history, recorded at the archive.\n");
const noteHash = "sha256-" + crypto.createHash("sha256").update(note).digest("hex");

let n = 0;
const at = (day) => `2026-09-${String(day).padStart(2, "0")}T12:00:00Z`;
const op = (fields, day) => ({ id: `seed:${++n}`, author: "seed", created: at(day), ...fields });

const shelf = "seed/welcome-shelf";
const ops = [
    op({ type: "item", hash: photoHash, name: "book.png", fileType: "image/png", properties: { title: "An open book", author: "OSL", type: "", description: "A picture to test offline images." } }, 1),
    op({ type: "item", hash: noteHash, name: "oral-history.txt", fileType: "text/plain", properties: { title: "Oral history, Dickinson Street", author: "Archive volunteers", type: "essay", description: "Memories of the corner store." } }, 2),
    op({ type: "item", url: "https://en.wikipedia.org/wiki/Community_archive", properties: { title: "What is a community archive?", author: "", type: "essay" } }, 3),
    op({ type: "name-collection", target: shelf, name: "Welcome shelf" }, 4),
];
ops.push(
    op({ type: "add-to-collection", target: shelf, item: "seed:1" }, 5),
    op({ type: "add-to-collection", target: shelf, item: "seed:2" }, 5),
    op({ type: "comment", target: "seed:2", body: "Find something that reminds you of home, and write about it here.", access: "public" }, 6),
);

for (const o of ops) {
    const err = validateOp(o);
    if (err) throw new Error(`${o.id}: ${err}`);
}

for (const [hash, data, type] of [[photoHash, photo, "image/png"], [noteHash, note, "text/plain"]]) {
    const res = await fetch(base + "media/" + hash, { method: "PUT", body: data, headers: { "Content-Type": type } });
    if (!res.ok) throw new Error(`media ${res.status} ${await res.text()}`);
}
const res = await fetch(base + "sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ops, since: Number.MAX_SAFE_INTEGER }),
});
if (!res.ok) throw new Error(`sync ${res.status} ${await res.text()}`);
const reply = await res.json();
console.log(`Seeded ${reply.acked.length} ops and 2 files into ${base} (node now holds ${reply.cursor} ops).`);
