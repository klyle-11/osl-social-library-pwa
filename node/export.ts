// The whole library as one zip: every document and its file, every note and reply,
// every detail and collection, whoever made them and whether anyone kept them.
// Written with Node's own modules (like the rest of the node): files are stored, not
// compressed, since PDFs, photos and films are compressed already.
import { createReadStream, statSync } from "node:fs";
import { crc32 } from "node:zlib";
import type { ServerResponse } from "node:http";
import type { Op } from "../core/types";
import { buildViews } from "../core/views";

export type ZipEntry = { name: string, data?: Buffer, file?: string };

const EXT: Record<string, string> = {
    "application/pdf": ".pdf", "application/epub+zip": ".epub", "text/plain": ".txt", "text/markdown": ".md",
    "image/jpeg": ".jpg", "image/png": ".png", "image/gif": ".gif", "image/webp": ".webp", "image/svg+xml": ".svg",
    "audio/mpeg": ".mp3", "audio/mp4": ".m4a", "audio/wav": ".wav", "audio/ogg": ".ogg",
    "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov"
};

// a file name anyone's computer accepts, from a title
function safeName(title: string): string {
    return title.normalize("NFKC").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 80) || "untitled";
}

// Everything readable, plus the raw log. fileFor says where a document's bytes are on disk.
export function exportEntries(ops: Op[], stewards: string[], fileFor: (doc: { hash?: string, url?: string }) => string | null, appVersion: string): ZipEntry[] {
    const v = buildViews(ops, { viewer: "", stewards });
    const who = (user: string) => user === "steward" ? "The library" : v.names[user] ?? `Guest ${user.replace(/^d-/, "").slice(0, 4)}`;
    const entries: ZipEntry[] = [];
    const used = new Set<string>();

    const documents = Object.values(v.documents).sort((a, b) => a.timestamp.localeCompare(b.timestamp)).map(doc => {
        let file: string | null = null;
        const onDisk = doc.fileType !== "link" ? fileFor(doc) : null;
        if (onDisk) {
            const ext = EXT[doc.fileType] ?? (doc.url?.match(/\.[a-z0-9]{1,5}$/i)?.[0] ?? "");
            let name = `files/${safeName(doc.properties.title)}${ext}`;
            for (let n = 2; used.has(name); n++) name = `files/${safeName(doc.properties.title)} (${n})${ext}`;
            used.add(name);
            entries.push({ name, file: onDisk });
            file = name;
        }
        const { thumbnail, editors, ...details } = doc.properties;
        return {
            id: doc.id,
            ...details,
            format: doc.fileType,
            ...(doc.fileType === "link" && { link: doc.url }),
            file,
            addedBy: who(doc.user),
            addedAt: doc.timestamp,
            whoCanEdit: editors ?? "everyone",
            collections: (v.collectionsByDocument[doc.id] ?? []).map(c => v.collections[c]?.name ?? "Untitled collection"),
            notes: (v.threads[doc.id] ?? []).map(a => ({
                id: a.op.id,
                by: a.anonymous ? "Someone" : who(a.op.user),
                at: a.op.timestamp,
                text: a.op.body,
                ...(a.parent && { replyTo: a.parent.id }),
                ...(a.anonymous && { withoutName: true })
            }))
        };
    });

    const library = {
        exportedAt: new Date().toISOString(),
        appVersion,
        counts: { documents: documents.length, notes: documents.reduce((n, d) => n + d.notes.length, 0), collections: Object.keys(v.collections).length, ops: ops.length },
        documents,
        collections: v.collectionOrder.map(id => v.collections[id]).map(c => ({
            name: c.name ?? "Untitled collection", by: who(c.owner), updated: c.updated,
            documents: c.documentIds.map(id => v.documents[id]?.properties.title ?? id)
        })),
        people: Object.fromEntries(v.people.filter(u => u !== "steward").map(u => [u, who(u)]))
    };

    const readme = [
        "OSL library export",
        `Made ${library.exportedAt}, app version ${appVersion}.`,
        "",
        `${library.counts.documents} documents, ${library.counts.notes} notes, ${library.counts.collections} collections.`,
        "",
        "library.json   Everything, readable: each document with its details as they stand now,",
        "               who added it and when, its collections, and its notes and replies",
        "               (replyTo is the id of the note answered). Notes written without a name",
        "               say \"Someone\". Also every collection, and everyone's names.",
        "files/         Each document's own file, named after its title. Links have none.",
        "ops.jsonl      The complete record, one change per line, oldest first: every addition,",
        "               detail, note, keep and hide. It's what the library is rebuilt from, so",
        "               it names the device behind every change, notes without a name included.",
        "",
        "Not in here: notes people kept private (they never leave their own phone), and anything",
        "still waiting on a phone to sync."
    ].join("\n");

    return [
        { name: "README.txt", data: Buffer.from(readme) },
        { name: "library.json", data: Buffer.from(JSON.stringify(library, null, 2)) },
        { name: "ops.jsonl", data: Buffer.from(ops.map(o => JSON.stringify(o)).join("\n") + "\n") },
        ...entries
    ];
}

// A plain zip (stored entries, UTF-8 names), streamed: a film is read twice
// (once for its checksum, once to send) but never held in memory.
export async function sendZip(res: ServerResponse, filename: string, entries: ZipEntry[]) {
    res.writeHead(200, {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="${filename}"`,
        "cache-control": "no-store"
    });
    const now = new Date();
    const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
    const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
    const central: Buffer[] = [];
    let offset = 0;
    const write = (b: Buffer) => new Promise<void>(ok => { offset += b.length; if (res.write(b)) ok(); else res.once("drain", ok); });

    for (const e of entries) {
        let size: number, crc = 0;
        if (e.data) {
            size = e.data.length;
            crc = crc32(e.data);
        } else {
            size = statSync(e.file!).size;
            if (size >= 0xffffffff || offset >= 0xffffffff) continue;   // past what a plain zip holds: left out
            for await (const chunk of createReadStream(e.file!)) crc = crc32(chunk as Buffer, crc);
        }
        const name = Buffer.from(e.name);
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6);   // UTF-8 names
        local.writeUInt16LE(0, 8); local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12);
        local.writeUInt32LE(crc >>> 0, 14); local.writeUInt32LE(size, 18); local.writeUInt32LE(size, 22);
        local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
        const header = Buffer.alloc(46);
        header.writeUInt32LE(0x02014b50, 0); header.writeUInt16LE(20, 4); header.writeUInt16LE(20, 6); header.writeUInt16LE(0x0800, 8);
        header.writeUInt16LE(0, 10); header.writeUInt16LE(time, 12); header.writeUInt16LE(date, 14);
        header.writeUInt32LE(crc >>> 0, 16); header.writeUInt32LE(size, 20); header.writeUInt32LE(size, 24);
        header.writeUInt16LE(name.length, 28); header.writeUInt32LE(offset, 42);
        central.push(header, name);
        await write(local); await write(name);
        if (e.data) await write(e.data);
        else for await (const chunk of createReadStream(e.file!)) await write(chunk as Buffer);
    }
    const dir = Buffer.concat(central);
    const end = Buffer.alloc(22);
    const count = central.length / 2;
    end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(count, 8); end.writeUInt16LE(count, 10);
    end.writeUInt32LE(dir.length, 12); end.writeUInt32LE(offset, 16);
    await write(dir);
    res.end(end);
}
