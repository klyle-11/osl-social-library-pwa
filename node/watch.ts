// A library's watch folder (W-D12): files put in a folder on the node become documents.
// Each new file is cloned into data/media/ (a copy-on-write clone where the disk can, a
// copy where it can't), hashed from that private copy, and added as a document by "the
// library". One file at a time, read in pieces, so a folder of films never fills memory.
import { createHash, randomBytes } from "node:crypto";
import {
    constants, copyFileSync, createReadStream, existsSync, readdirSync, renameSync, rmSync, statSync, watch, writeFileSync,
    type FSWatcher
} from "node:fs";
import { extname, join, relative, sep } from "node:path";
import { readJson, writeAside } from "./files";
import type { Libraries } from "./libraries";
import type { Op } from "../core/types";

export const FOLDER_USER = "folder";
const SCAN_EVERY_MS = 60_000;
const SETTLE_MS = 5_000;          // a file changed this recently may still be being written
const MAX_FILES = 10_000;         // per scan: a huge folder is taken in turns
const MAX_DEPTH = 4;
const PARTIAL = /(\.(part|partial|crdownload|download|tmp|temp)|~)$/i;

const TYPES: Record<string, [string, string]> = {
    ".pdf": ["application/pdf", ""], ".epub": ["application/epub+zip", "book"],
    ".txt": ["text/plain", ""], ".md": ["text/plain", ""],
    ".jpg": ["image/jpeg", "photo"], ".jpeg": ["image/jpeg", "photo"], ".png": ["image/png", "photo"],
    ".gif": ["image/gif", "photo"], ".webp": ["image/webp", "photo"], ".heic": ["image/heic", "photo"],
    ".mp3": ["audio/mpeg", "audio"], ".m4a": ["audio/mp4", "audio"], ".wav": ["audio/wav", "audio"], ".ogg": ["audio/ogg", "audio"],
    ".flac": ["audio/flac", "audio"], ".mp4": ["video/mp4", "film"], ".webm": ["video/webm", "film"], ".mov": ["video/quicktime", "film"]
};

type Seen = { size: number, mtime: number, hash: string };
type State = { seq: number, folder: string, files: Record<string, Seen> };

export function titleFromFile(name: string): string {
    const base = name.slice(0, name.length - extname(name).length).replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim();
    return (base.charAt(0).toUpperCase() + base.slice(1)).slice(0, 200) || "Untitled";
}

export type Watcher = { refresh(): void, scan(id: string): Promise<number> };

export function startWatching(deps: { libraries: Libraries, media: string, maxBytes: number, say?: (s: string) => void }): Watcher {
    const say = deps.say ?? console.log;
    const watchers = new Map<string, { folder: string, fsw: FSWatcher | null, timer: ReturnType<typeof setTimeout> | null }>();
    const busy = new Set<string>();

    const stateFile = (id: string) => join(deps.libraries.dir(id), "watched.json");

    function load(id: string, folder: string): State {
        const s = readJson<State>(stateFile(id), () => ({ seq: 0, folder, files: {} }));
        // the counter never goes back, even if the state file was lost: look at the log too
        for (const op of deps.libraries.log(id).log) {
            if (op.user === FOLDER_USER) s.seq = Math.max(s.seq, Number(op.id.slice(op.id.lastIndexOf(":") + 1)) || 0);
        }
        if (s.folder !== folder) { s.folder = folder; s.files = {}; }   // another folder: its files are new to it
        return s;
    }

    // every file under the folder, as paths relative to it, up to the budget
    function walk(folder: string): string[] {
        const out: string[] = [];
        const visit = (dir: string, depth: number) => {
            let names: string[];
            try { names = readdirSync(dir); } catch { return; }
            for (const name of names.sort()) {
                if (out.length >= MAX_FILES) return;
                if (name.startsWith(".") || PARTIAL.test(name)) continue;
                const full = join(dir, name);
                let st;
                try { st = statSync(full); } catch { continue; }
                if (st.isDirectory()) { if (depth < MAX_DEPTH) visit(full, depth + 1); }
                else if (st.isFile()) out.push(relative(folder, full));
            }
        };
        visit(folder, 0);
        return out;
    }

    function hashFile(file: string): Promise<string> {
        return new Promise((ok, fail) => {
            const h = createHash("sha256");
            createReadStream(file).on("data", c => h.update(c)).on("end", () => ok("sha256-" + h.digest("hex"))).on("error", fail);
        });
    }

    async function scan(id: string): Promise<number> {
        const lib = deps.libraries.get(id);
        if (!lib?.watch || busy.has(id)) return 0;
        const folder = lib.watch.folder;
        if (!existsSync(folder)) return 0;
        busy.add(id);
        let added = 0;
        try {
            const state = load(id, folder);
            const log = deps.libraries.log(id);
            for (const rel of walk(folder)) {
                const full = join(folder, rel);
                let st;
                try { st = statSync(full); } catch { continue; }
                const seen = state.files[rel];
                if (seen && seen.size === st.size && seen.mtime === st.mtimeMs) continue;
                if (Date.now() - st.mtimeMs < SETTLE_MS || !st.size) continue;   // still arriving: next time
                if (st.size > deps.maxBytes) { state.files[rel] = { size: st.size, mtime: st.mtimeMs, hash: "" }; say(`watch ${id}: ${rel} is too large to take`); continue; }

                // our own copy first, then its hash: the original can change while we read it
                const temp = join(deps.media, `.import-${randomBytes(6).toString("hex")}`);
                try {
                    copyFileSync(full, temp, constants.COPYFILE_FICLONE);
                    const hash = await hashFile(temp);
                    const [fileType, medium] = TYPES[extname(rel).toLowerCase()] ?? ["application/octet-stream", ""];
                    if (existsSync(join(deps.media, hash))) rmSync(temp);
                    else { renameSync(temp, join(deps.media, hash)); writeFileSync(join(deps.media, hash + ".type"), fileType); }
                    state.files[rel] = { size: st.size, mtime: st.mtimeMs, hash };
                    // the same bytes already here (under another name, or added by someone): no second document
                    if (!log.documentHashes.has(hash)) {
                        const op: Op = {
                            id: `${FOLDER_USER}:${++state.seq}`, user: FOLDER_USER, timestamp: new Date().toISOString(), type: "document",
                            fileType, hash, properties: { title: titleFromFile(rel.split(sep).pop()!), author: "", type: medium as "" }
                        };
                        const r = log.accept([op]);
                        if (r.added) added++;
                        else say(`watch ${id}: ${rel} was not added (${r.rejected[0] ?? "conflict"})`);
                    }
                    writeAside(stateFile(id), JSON.stringify(state));
                } catch (e) {
                    rmSync(temp, { force: true });
                    say(`watch ${id}: couldn't take ${rel} (${(e as Error).message})`);
                }
            }
            if (added) say(`watch ${id}: +${added} document${added === 1 ? "" : "s"} from ${folder}`);
        } finally {
            busy.delete(id);
        }
        return added;
    }

    // a change in the folder: look again once it has been quiet for a moment
    function soon(id: string) {
        const w = watchers.get(id);
        if (!w) return;
        if (w.timer) clearTimeout(w.timer);
        w.timer = setTimeout(() => { w.timer = null; void scan(id); }, SETTLE_MS + 500);
        w.timer.unref?.();
    }

    // start, stop or move each library's watch to match the settings
    function refresh() {
        const wanted = new Map(deps.libraries.list().filter(l => l.watch).map(l => [l.id, l.watch!.folder]));
        for (const [id, w] of watchers) {
            if (wanted.get(id) === w.folder) continue;
            w.fsw?.close();
            if (w.timer) clearTimeout(w.timer);
            watchers.delete(id);
        }
        for (const [id, folder] of wanted) {
            if (watchers.has(id)) continue;
            let fsw: FSWatcher | null = null;
            // recursive watching isn't everywhere; the scan every minute covers it
            try { fsw = watch(folder, { recursive: true, persistent: false }, () => soon(id)); }
            catch { try { fsw = watch(folder, { persistent: false }, () => soon(id)); } catch { fsw = null; } }
            fsw?.on("error", () => { /* the folder went away; the next scan says so */ });
            watchers.set(id, { folder, fsw, timer: null });
            say(`watch ${id}: watching ${folder}`);
            void scan(id);
        }
    }

    setInterval(() => { for (const id of watchers.keys()) void scan(id); }, SCAN_EVERY_MS).unref();
    refresh();
    return { refresh, scan };
}
