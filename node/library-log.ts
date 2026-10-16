// One library's op log: an append-only file in arrival order, and what the node needs to
// answer quickly from it. Each library has its own (node/libraries.ts).
import {
    appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, renameSync, writeFileSync, writeSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import { tombstone, validateOp } from "../core/ops";
import { canonical, compareOps } from "../core/merge";
import { isShareable } from "../core/store";
import { PresenceBoard } from "../core/presence";
import { positionFor } from "../core/cursor";
import { collectionOwner } from "../core/ops";
import { defaultAccess, inAudience, isKept, parseAudience, personOf } from "../core/access";
import type { CollectionAccess, Identity, Op } from "../core/types";

export type LogPaths = {
    log: string, logId: string, conflicts: string,
    origins?: string,       // where each op came from (an address, or "radio"): for moderators
    takenDown?: string      // files removed here, so the same bytes can't come straight back
};

export type AcceptResult = {
    added: number, duplicates: number, conflicts: number,
    rejected: string[],                         // reasons, as before
    refused: { id: string, reason: string }[],  // which ops, for the app to say so
    keep: string[], cursor: string, node: { id: string, role: "library" }
};

// an op that is about a collection's contents or name (its access ops go to everyone)
const COLLECTION_OPS = new Set(["add-to-collection", "remove-from-collection", "name-collection"]);

export class LibraryLog {
    readonly log: Op[] = [];
    readonly logId: string;
    readonly board = new PresenceBoard();
    readonly hashes = new Set<string>();        // files it may hand out: its documents', and uploads on their way
    readonly documentHashes = new Set<string>();    // files its documents point at
    readonly authors = new Set<string>();       // every device that wrote here
    // a collection's ops, so someone who gains access can be sent what came before
    private byCollection = new Map<string, Op[]>();
    private access = new Map<string, CollectionAccess[]>();
    private byId = new Map<string, string>();   // id -> canonical form
    private at = new Map<string, number>();     // id -> position in the log
    // what has been taken back, and how (only ops the node let in are in the log)
    readonly redacted = new Map<string, "strike" | "remove">();
    readonly origins = new Map<string, string>();
    readonly takenDown = new Set<string>();
    private freed: string[] = [];               // files no op here points at any more (takeFreed)
    private fd: number;
    private paths: LogPaths;
    // moves whenever who may see a collection changes, so phones know to ask again
    accessRevision = 0;

    constructor(paths: LogPaths) {
        this.paths = paths;
        // A cursor is "<log id>.<position>". The log id is made with the log, so after a clean
        // start, or on another node, a phone's old cursor matches nothing and it reads from the start.
        const saved = existsSync(paths.log) && existsSync(paths.logId) ? readFileSync(paths.logId, "utf8").trim() : "";
        this.logId = saved || this.newLogId();
        if (existsSync(paths.log)) this.load();
        if (paths.origins && existsSync(paths.origins)) {
            for (const line of readFileSync(paths.origins, "utf8").split("\n")) {
                try { const o = JSON.parse(line) as { id: string, from: string }; if (o.id) this.origins.set(o.id, o.from); } catch { /* a cut line */ }
            }
        }
        if (paths.takenDown && existsSync(paths.takenDown)) {
            try { for (const h of JSON.parse(readFileSync(paths.takenDown, "utf8")) as string[]) this.takenDown.add(h); } catch { /* unreadable: none */ }
        }
        // Held open for appending. Each batch is on disk (fsync) before anyone is told it was
        // stored: a drop point deletes its copy when the library says so.
        this.fd = openSync(paths.log, "a");
    }

    private newLogId(): string {
        const id = randomBytes(6).toString("hex");
        writeFileSync(this.paths.logId, id);
        return id;
    }

    private load() {
        // A power cut during a write leaves a last line cut short. It is skipped (and kept in
        // the file), so the node still starts with everything else.
        const text = readFileSync(this.paths.log, "utf8");
        let damaged = 0;
        for (const line of text.split("\n")) {
            if (!line.trim()) continue;
            let parsed: unknown;
            try { parsed = JSON.parse(line); } catch { damaged++; continue; }
            const v = validateOp(parsed);
            if (v.ok && !this.byId.has(v.op.id)) this.add(v.op, canonical(v.op));
        }
        // without this the next op would be glued onto the cut line, and lost with it
        if (text.length && !text.endsWith("\n")) appendFileSync(this.paths.log, "\n");
        if (damaged) console.warn(`${damaged} damaged line${damaged === 1 ? "" : "s"} in ${this.paths.log} skipped (left in the file).`);
    }

    private add(op: Op, key: string) {
        this.at.set(op.id, this.log.length);
        this.log.push(op);
        this.byId.set(op.id, key);
        this.authors.add(op.user);
        if (op.type === "document" && op.hash) { this.hashes.add(op.hash); this.documentHashes.add(op.hash); }
        // the small pictures in the gallery are files too
        if (op.type === "document" && op.properties.thumbnail) this.hashes.add(op.properties.thumbnail);
        if (op.type === "describe" && op.field === "thumbnail" && op.value) this.hashes.add(op.value);
        if (op.type === "redact" && this.redacted.get(op.target) !== "remove") this.redacted.set(op.target, op.mode);
        if (COLLECTION_OPS.has(op.type) && "collectionId" in op) {
            (this.byCollection.get(op.collectionId) ?? this.byCollection.set(op.collectionId, []).get(op.collectionId)!).push(op);
        }
        if (op.type === "collection-access") {
            (this.access.get(op.collectionId) ?? this.access.set(op.collectionId, []).get(op.collectionId)!).push(op);
            this.accessRevision++;
        }
    }

    get node() { return { id: this.logId, role: "library" as const }; }
    get(id: string): Op | undefined { const i = this.at.get(id); return i === undefined ? undefined : this.log[i]; }

    // the files freed since last asked: the server deletes those no library still has
    takeFreed(): string[] { const f = this.freed; this.freed = []; return f; }
    cursorNow() { return `${this.logId}.${this.log.length}`; }
    // what a phone sent is every cursor it holds; this log reads its own (core/cursor.ts)
    position(after: string | null) { return positionFor(after ?? "", this.logId, this.log.length); }

    // Stores what's new, on disk first. `check` says why an op may not be taken from this
    // sender: refused for good (a reason), or left with the phone for later ({ keep }).
    accept(input: unknown[], check?: (op: Op) => string | { keep: string } | null, from?: string): AcceptResult {
        let added = 0, duplicates = 0, conflicts = 0;
        const rejected: string[] = [];
        const keep: string[] = [];
        const refused: { id: string, reason: string }[] = [];
        const refuse = (item: unknown, reason: string) => {
            rejected.push(reason);
            const id = (item as { id?: unknown } | null)?.id;
            if (typeof id === "string") refused.push({ id, reason });
        };
        const fresh = new Map<string, { op: Op, key: string }>();
        for (const item of input) {
            const v = validateOp(item);
            if (!v.ok) { refuse(item, v.reason); continue; }
            if (!isShareable(v.op)) { refuse(item, "private annotations stay on the phone"); continue; }
            // what was taken back here never comes back in full: from a phone that had it, or by radio
            const op = this.redacted.has(v.op.id) ? tombstone(v.op) : v.op;
            const key = canonical(op);
            const existing = this.byId.get(op.id) ?? fresh.get(op.id)?.key;
            if (existing === key || (existing !== undefined && this.redacted.has(op.id))) { duplicates++; continue; }
            if (existing !== undefined) {
                // same id, different payload: keep the first, record the other, never overwrite
                conflicts++;
                appendFileSync(this.paths.conflicts, JSON.stringify({ at: new Date().toISOString(), op: v.op }) + "\n");
                continue;
            }
            const no = check?.(op);
            if (typeof no === "string") { refuse(item, no); continue; }
            if (no) { keep.push(op.id); continue; }
            fresh.set(op.id, { op, key });
            added++;
        }
        if (fresh.size) {
            // on disk first; only then in the log that answers "duplicate" to a retry
            writeSync(this.fd, [...fresh.values()].map(f => JSON.stringify(f.op) + "\n").join(""));
            fsyncSync(this.fd);
            for (const f of fresh.values()) this.add(f.op, f.key);
            if (from && this.paths.origins) {
                appendFileSync(this.paths.origins, [...fresh.keys()].map(id => JSON.stringify({ id, from }) + "\n").join(""));
                for (const id of fresh.keys()) this.origins.set(id, from);
            }
            // what was taken back is erased now, from the file too
            const targets = [...fresh.values()].filter(f => f.op.type === "redact").map(f => (f.op as { target: string }).target);
            if (targets.length) this.purge(targets);
        }
        // `keep`: ops left with the phone for now (a drop point also keeps ops when it is full)
        return { added, duplicates, conflicts, rejected, refused, keep, cursor: this.cursorNow(), node: this.node };
    }

    // Erases what was taken back: each op's words, and for an upload its details and file too.
    // The log file is written again with those lines replaced (aside, then renamed over it),
    // so the words are gone from the disk, not only from what is sent.
    purge(ids: string[]) {
        const changed = new Map<string, Op>();
        const files = new Set<string>();
        const erase = (op: Op) => {
            const t = tombstone(op);
            if (canonical(t) === this.byId.get(op.id)) return;
            changed.set(op.id, t);
            if (op.type === "document") {
                if (op.hash) files.add(op.hash);
                if (op.properties.thumbnail) files.add(op.properties.thumbnail);
            }
            if (op.type === "describe" && op.field === "thumbnail" && op.value) files.add(op.value);
        };
        for (const id of ids) {
            const op = this.get(id);
            if (!op) continue;
            erase(op);
            // an upload taken back takes its details with it
            if (op.type === "document") for (const d of this.log) if (d.type === "describe" && d.target === op.id) erase(d);
        }
        if (!changed.size) return;
        for (const [id, t] of changed) {
            this.log[this.at.get(id)!] = t;
            this.byId.set(id, canonical(t));
        }
        this.rewrite(changed);
        // a file no longer pointed at by anything here is freed
        for (const h of files) {
            if (this.pointsAt(h)) continue;
            this.hashes.delete(h);
            this.documentHashes.delete(h);
            this.takenDown.add(h);
            this.freed.push(h);
        }
        if (files.size && this.paths.takenDown) writeFileSync(this.paths.takenDown, JSON.stringify([...this.takenDown]));
    }

    private pointsAt(hash: string): boolean {
        return this.log.some(o =>
            (o.type === "document" && (o.hash === hash || o.properties.thumbnail === hash)) ||
            (o.type === "describe" && o.field === "thumbnail" && o.value === hash));
    }

    private rewrite(changed: Map<string, Op>) {
        const lines = readFileSync(this.paths.log, "utf8").split("\n").map(line => {
            if (!line.trim()) return line;
            try {
                const id = (JSON.parse(line) as { id?: unknown }).id;
                return typeof id === "string" && changed.has(id) ? JSON.stringify(changed.get(id)) : line;
            } catch {
                return line;   // a cut line stays as it was
            }
        });
        const tmp = this.paths.log + ".tmp";
        const fd = openSync(tmp, "w");
        writeSync(fd, lines.join("\n"));
        fsyncSync(fd);
        closeSync(fd);
        closeSync(this.fd);
        renameSync(tmp, this.paths.log);
        this.fd = openSync(this.paths.log, "a");
    }

    // Who may see a collection, as its owner last said (everyone, if they never did; only
    // them for Kept).
    private see(collectionId: string, identity: Identity) {
        const owner = personOf(identity, collectionOwner(collectionId));
        const ops = (this.access.get(collectionId) ?? []).filter(o => personOf(identity, o.user) === owner).sort(compareOps);
        for (let i = ops.length - 1; i >= 0; i--) {
            const a = parseAudience(ops[i].see);
            if (a && parseAudience(ops[i].add)) return { owner, see: a };
        }
        return { owner, see: defaultAccess(collectionId).see };
    }

    // may this viewer have this collection? An admin has everyone's Kept.
    private visible(collectionId: string, viewer: string | null, identity: Identity, admin: boolean): boolean {
        const { owner, see } = this.see(collectionId, identity);
        if (see.kind === "everyone" || (admin && isKept(collectionId))) return true;
        return viewer !== null && inAudience(see, viewer, owner, identity);
    }

    // A test for ops this viewer must not be sent: what's in, and what's called, a collection
    // that isn't for them. `viewer` is a person (an account, or a guest's device), or null for
    // anyone at all. The answer for each collection is worked out once per call.
    notFor(viewer: string | null, identity: Identity, admin = false): (op: Op) => boolean {
        const known = new Map<string, boolean>();
        return op => {
            if (!COLLECTION_OPS.has(op.type) || !("collectionId" in op)) return false;
            let hide = known.get(op.collectionId);
            if (hide === undefined) {
                hide = !this.visible(op.collectionId, viewer, identity, admin);
                known.set(op.collectionId, hide);
            }
            return hide;
        };
    }

    // Everything in the collections this viewer may see that aren't for everyone: sent again
    // when their access may have changed, since their cursor has moved past it.
    sharedWith(viewer: string, identity: Identity, admin = false): Op[] {
        const out: Op[] = [];
        for (const id of this.byCollection.keys()) {
            if (this.see(id, identity).see.kind === "everyone") continue;
            if (this.visible(id, viewer, identity, admin)) out.push(...(this.byCollection.get(id) ?? []));
        }
        return out;
    }

    close() {
        closeSync(this.fd);
    }
}
