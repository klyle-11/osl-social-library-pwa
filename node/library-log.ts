// One library's op log: an append-only file in arrival order, and what the node needs to
// answer quickly from it. Each library has its own (node/libraries.ts).
import {
    appendFileSync, closeSync, existsSync, fsyncSync, openSync, readFileSync, writeFileSync, writeSync
} from "node:fs";
import { randomBytes } from "node:crypto";
import { validateOp } from "../core/ops";
import { canonical, compareOps } from "../core/merge";
import { isShareable } from "../core/store";
import { PresenceBoard } from "../core/presence";
import { positionFor } from "../core/cursor";
import { collectionOwner } from "../core/ops";
import { defaultAccess, inAudience, isKept, parseAudience, personOf } from "../core/access";
import type { CollectionAccess, Identity, Op } from "../core/types";

export type LogPaths = { log: string, logId: string, conflicts: string };

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
        this.log.push(op);
        this.byId.set(op.id, key);
        this.authors.add(op.user);
        if (op.type === "document" && op.hash) { this.hashes.add(op.hash); this.documentHashes.add(op.hash); }
        if (COLLECTION_OPS.has(op.type) && "collectionId" in op) {
            (this.byCollection.get(op.collectionId) ?? this.byCollection.set(op.collectionId, []).get(op.collectionId)!).push(op);
        }
        if (op.type === "collection-access") {
            (this.access.get(op.collectionId) ?? this.access.set(op.collectionId, []).get(op.collectionId)!).push(op);
            this.accessRevision++;
        }
    }

    get node() { return { id: this.logId, role: "library" as const }; }
    cursorNow() { return `${this.logId}.${this.log.length}`; }
    // what a phone sent is every cursor it holds; this log reads its own (core/cursor.ts)
    position(after: string | null) { return positionFor(after ?? "", this.logId, this.log.length); }

    // Stores what's new, on disk first. `check` says why an op may not be taken from this
    // sender: refused for good (a reason), or left with the phone for later ({ keep }).
    accept(input: unknown[], check?: (op: Op) => string | { keep: string } | null): AcceptResult {
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
            const key = canonical(v.op);
            const existing = this.byId.get(v.op.id) ?? fresh.get(v.op.id)?.key;
            if (existing === key) { duplicates++; continue; }
            if (existing !== undefined) {
                // same id, different payload: keep the first, record the other, never overwrite
                conflicts++;
                appendFileSync(this.paths.conflicts, JSON.stringify({ at: new Date().toISOString(), op: v.op }) + "\n");
                continue;
            }
            const no = check?.(v.op);
            if (typeof no === "string") { refuse(item, no); continue; }
            if (no) { keep.push(v.op.id); continue; }
            fresh.set(v.op.id, { op: v.op, key });
            added++;
        }
        if (fresh.size) {
            // on disk first; only then in the log that answers "duplicate" to a retry
            writeSync(this.fd, [...fresh.values()].map(f => JSON.stringify(f.op) + "\n").join(""));
            fsyncSync(this.fd);
            for (const f of fresh.values()) this.add(f.op, f.key);
        }
        // `keep`: ops left with the phone for now (a drop point also keeps ops when it is full)
        return { added, duplicates, conflicts, rejected, refused, keep, cursor: this.cursorNow(), node: this.node };
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
