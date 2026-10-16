import {
    createAddToCollection, createAnnotation, createCollectionAccess, createDescribe, createDocument, createHide,
    createNameCollection, createNameUser, createRedact, createRemoveFromCollection, keptCollectionId, parseOpId, tombstone,
    validateOp
} from "./ops";
import { canonical } from "./merge";
import { mergeOps } from "./merge";
import { makeBundle, readBundle, type Bundle } from "./bundle";
import { rememberCursor } from "./cursor";
import { isKept } from "./access";
import type { Access, CollectionId, Conflict, DescribeField, DocumentProperties, Op, OpContext, OpId } from "./types";

// One interface, one implementation per shell:
// MemoryStorage (tests), LocalStorageStorage (fast route), IndexedDBStorage (gate four).
export interface StorageAdapter {
    loadOps(): Promise<unknown[]>;              // unknown: everything is validated on the way in
    appendOps(ops: Op[]): Promise<void>;        // an op with an id already there replaces it (an erased one)
    getMeta(key: string): Promise<string | undefined>;
    setMeta(key: string, value: string): Promise<void>;
    putMedia(hash: string, data: string): Promise<void>;
    getMedia(hash: string): Promise<string | undefined>;
    deleteMedia(hash: string): Promise<void>;
}

// Which kind of node answered: the library (the Pi) keeps everything; a drop point
// is an inbox that passes ops on to the library by radio.
export type NodeRole = "library" | "droppoint";

// What a node says to a push. `keep` lists ops it left with the phone (a drop point
// whose flash is full, or an op too big for the radio): they stay in the outbox.
// `refused`: ops the node won't take, and why (they stay on this device only).
export type PushReply = { keep: OpId[], role: NodeRole, refused?: { id: OpId, reason: string }[] };

// How ops move between this device and a node. HTTP now; a bundle file or radio later.
export interface Transport {
    pushOps(ops: Op[]): Promise<PushReply>;
    // `cursor` is every cursor this device holds, comma-separated (see cursor.ts)
    pullOps(cursor: string): Promise<{ ops: unknown[], cursor: string }>;
    // false: this node doesn't keep files (a drop point), so the file waits for the library
    pushMedia(hash: string, data: string): Promise<boolean>;
}

// Ops per request are capped by size, so a drop point's small memory can take them.
// One op bigger than this still goes, alone.
export const PUSH_BATCH_BYTES = 8000;

// The outside world, passed in so the core never reads a clock or randomness itself.
export type StoreEnv = {
    now(): string,
    newDeviceId(): string
};

export type SyncResult = { sent: number, received: number };

// Private annotations never leave the device (they aren't in the outbox).
export function isShareable(op: Op): boolean {
    return !(op.type === "annotation" && op.access === "private");
}

// The facade components call. Components never build ops themselves.
export class LibraryStore {
    ops: Op[] = [];
    conflicts: Conflict[] = [];
    rejected: { input: unknown, reason: string }[] = [];
    user = "";
    // who this device writes for: the account it's signed in as, or (a guest) the device itself
    person = "";
    outbox: OpId[] = [];
    mediaOutbox: string[] = [];
    // handed in at a drop point, not yet seen coming back from the library
    relayed: OpId[] = [];
    // told when the node won't take something, and why
    onRefused: ((refused: { id: OpId, reason: string }[]) => void) | null = null;

    private seq = 0;
    private listeners = new Set<() => void>();
    private storage: StorageAdapter;
    private env: StoreEnv;
    private syncing: Promise<SyncResult> | null = null;

    constructor(storage: StorageAdapter, env: StoreEnv) {
        this.storage = storage;
        this.env = env;
    }

    async open(seed: unknown[] = []): Promise<void> {
        let user = await this.storage.getMeta("user");
        if (!user) {
            user = this.env.newDeviceId();
            await this.storage.setMeta("user", user);
        }
        this.user = user;
        this.person ||= user;

        const stored = this.accept(await this.storage.loadOps());
        // The seed (the node's catalog) is merged in memory on every open and never
        // written to storage, so it can't double up and can change between sessions.
        const seedOps = this.accept(seed);

        // The counter must never go backwards: take the larger of the saved
        // counter and the highest counter among this device's own ops.
        let seq = Number(await this.storage.getMeta("seq")) || 0;
        for (const op of stored) {
            const p = parseOpId(op.id);
            if (p && p.user === user && p.seq > seq) seq = p.seq;
        }
        this.seq = seq;
        this.outbox = parseList(await this.storage.getMeta("outbox"));
        this.mediaOutbox = parseList(await this.storage.getMeta("mediaOutbox"));
        this.relayed = parseList(await this.storage.getMeta("relayed"));

        this.setOps(mergeOps(seedOps, stored));
    }

    // merge a fresh copy of the catalog without persisting it
    mergeSeed(seed: unknown[]): void {
        this.setOps(mergeOps(this.ops, this.accept(seed)));
    }

    subscribe(fn: () => void): () => void {
        this.listeners.add(fn);
        return () => { this.listeners.delete(fn); };
    }

    // ---- actions ----

    addDocument(fields: { url?: string, hash?: string, fileType: string, properties: DocumentProperties }): Promise<OpId> {
        return this.commit(ctx => [createDocument(ctx, fields)]);
    }

    annotate(documentId: OpId, body: string, access: Access, replyTo?: OpId): Promise<OpId> {
        return this.commit(ctx => [createAnnotation(ctx, documentId, body, access, replyTo)]);
    }

    // Signed in (`account`), this device writes for that account: its Kept and its new
    // collections are the account's, shared by all of the account's devices.
    setPerson(account: string | null) {
        this.person = account ?? this.user;
    }

    // Become a new device: after signing out, or to start fresh when signing in on a device
    // that wrote as a guest. What the old id wrote stays its own, and still syncs.
    async renew(): Promise<string> {
        const user = this.env.newDeviceId();
        await this.storage.setMeta("user", user);
        await this.storage.setMeta("seq", "0");
        this.user = user;
        this.person = user;
        this.seq = 0;
        this.notify();
        return user;
    }

    // one tap: into this person's "Kept" collection
    keep(documentId: OpId): Promise<OpId> {
        return this.addToCollection(keptCollectionId(this.person), [documentId]);
    }

    unkeep(documentId: OpId): Promise<OpId> {
        return this.removeFromCollection(keptCollectionId(this.person), documentId);
    }

    // The new collection's id comes from this device's counter, so it can't collide. An
    // account's collections carry the device too: two of its devices count separately.
    // `access`: who may see it and add to it from the start (core/access.ts)
    async createCollection(name: string, documentIds: OpId[] = [], access?: { see: string, add: string }): Promise<CollectionId> {
        let collectionId = "";
        await this.commit(ctx => {
            collectionId = this.person === ctx.user ? `${ctx.user}/${ctx.seq}` : `${this.person}/${ctx.user}.${ctx.seq}`;
            const named = createNameCollection(ctx, collectionId, name);
            return access ? [named, createCollectionAccess({ ...ctx, seq: ctx.seq + 1 }, collectionId, access.see, access.add)] : [named];
        }, access ? 2 : 1);
        if (documentIds.length) await this.addToCollection(collectionId, documentIds);
        return collectionId;
    }

    // one op per document: small ops, and each can be undone on its own
    addToCollection(collectionId: CollectionId, documentIds: OpId[]): Promise<OpId> {
        return this.commit(ctx => documentIds.map((d, i) =>
            createAddToCollection({ ...ctx, seq: ctx.seq + i }, collectionId, d)), documentIds.length);
    }

    removeFromCollection(collectionId: CollectionId, documentId: OpId): Promise<OpId> {
        return this.commit(ctx => [createRemoveFromCollection(ctx, collectionId, documentId)]);
    }

    nameCollection(collectionId: CollectionId, name: string): Promise<OpId> {
        return this.commit(ctx => [createNameCollection(ctx, collectionId, name)]);
    }

    // who may see it and who may add to it (core/access.ts): only the owner's count
    setCollectionAccess(collectionId: CollectionId, see: string, add: string): Promise<OpId> {
        return this.commit(ctx => [createCollectionAccess(ctx, collectionId, see, add)]);
    }

    setName(name: string): Promise<OpId> {
        return this.commit(ctx => [createNameUser(ctx, name)]);
    }

    hide(target: OpId): Promise<OpId> {
        return this.commit(ctx => [createHide(ctx, target)]);
    }

    // take something back: "strike" leaves it in place with its words ***, "remove" takes it away
    redact(target: OpId, mode: "strike" | "remove"): Promise<OpId> {
        return this.commit(ctx => [createRedact(ctx, target, mode)]);
    }

    // Erase this device's own copy of what was taken back (the views say which, as only they
    // know who may): the words go, and a removed upload's file. Nothing that is gone comes back.
    async purge(ids: OpId[]): Promise<void> {
        const byId = new Map(this.ops.map(o => [o.id, o]));
        const erased: Op[] = [];
        const files: string[] = [];
        for (const id of ids) {
            const op = byId.get(id);
            if (!op) continue;
            const t = tombstone(op);
            if (canonical(t) === canonical(op)) continue;
            erased.push(t);
            if (op.type === "document" && op.hash) files.push(op.hash);
        }
        if (!erased.length) return;
        await this.storage.appendOps(erased);
        for (const hash of files) {
            await this.storage.deleteMedia(hash);
            this.mediaOutbox = this.mediaOutbox.filter(h => h !== hash);
        }
        if (files.length) await this.storage.setMeta("mediaOutbox", JSON.stringify(this.mediaOutbox));
        const replace = new Map(erased.map(o => [o.id, o]));
        this.ops = this.ops.map(o => replace.get(o.id) ?? o);
        this.notify();
    }

    // fill in or correct a document's details: one op per changed field
    describe(documentId: OpId, changes: Partial<Record<DescribeField, string>>): Promise<OpId> {
        const fields = Object.entries(changes) as [DescribeField, string][];
        return this.commit(ctx => fields.map(([field, value], i) =>
            createDescribe({ ...ctx, seq: ctx.seq + i }, documentId, field, value)), fields.length);
    }

    // the uploader's prompts: the notes pinned on a document, in order (empty: none)
    setPrompts(documentId: OpId, noteIds: OpId[]): Promise<OpId> {
        return this.describe(documentId, { prompts: [...new Set(noteIds)].join(",") });
    }

    // media this person adds: kept locally, and queued for the node
    async putMedia(hash: string, data: string): Promise<void> {
        await this.storage.putMedia(hash, data);
        if (!this.mediaOutbox.includes(hash)) {
            this.mediaOutbox = [...this.mediaOutbox, hash];
            await this.storage.setMeta("mediaOutbox", JSON.stringify(this.mediaOutbox));
        }
    }

    getMedia(hash: string): Promise<string | undefined> {
        return this.storage.getMedia(hash);
    }

    // ---- moving ops between devices ----

    // push what's waiting, then pull what's new. Safe to call often; calls overlap into one.
    sync(transport: Transport): Promise<SyncResult> {
        if (!this.syncing) {
            this.syncing = this.runSync(transport).finally(() => { this.syncing = null; });
        }
        return this.syncing;
    }

    private async runSync(transport: Transport): Promise<SyncResult> {
        // media first, so an op never arrives before the photo it points at
        for (const hash of [...this.mediaOutbox]) {
            const data = await this.storage.getMedia(hash);
            if (data && !(await transport.pushMedia(hash, data))) break;   // no files here: they wait
            this.mediaOutbox = this.mediaOutbox.filter(h => h !== hash);
            await this.storage.setMeta("mediaOutbox", JSON.stringify(this.mediaOutbox));
        }

        // an op pointing at a file that is still waiting waits with it
        const waitingFiles = new Set(this.mediaOutbox);
        const byId = new Map(this.ops.map(o => [o.id, o]));
        const orphans = this.outbox.filter(id => !byId.has(id));
        const ops = this.outbox.map(id => byId.get(id))
            .filter((o): o is Op => !!o && !(o.type === "document" && !!o.hash && waitingFiles.has(o.hash)));
        if (orphans.length) await this.saveOutbox(this.outbox.filter(id => !orphans.includes(id)));

        let sent = 0;
        for (const batch of batches(ops, PUSH_BATCH_BYTES)) {
            const reply = await transport.pushOps(batch);
            if (reply.refused?.length) this.onRefused?.(reply.refused);
            const keep = new Set(reply.keep);
            const taken = batch.map(o => o.id).filter(id => !keep.has(id));
            sent += taken.length;
            // only clear what was taken; anything committed meanwhile stays queued
            await this.saveOutbox(this.outbox.filter(id => !taken.includes(id)));
            if (reply.role === "droppoint") {
                // a collection that isn't for everyone doesn't come back by radio: don't wait for it
                const quiet = restrictedCollections(this.ops);
                const tracked = taken.filter(id => {
                    const op = byId.get(id);
                    return !(op && "collectionId" in op && quiet.has(op.collectionId)) && !this.relayed.includes(id);
                });
                this.relayed = [...this.relayed, ...tracked];
                await this.storage.setMeta("relayed", JSON.stringify(this.relayed));
            }
        }

        const cursors = await this.loadCursors();
        const pulled = await transport.pullOps(cursors.join(","));
        // An op that comes back from a node has reached the library: drop points only
        // hand out what came to them from the library.
        const back = new Set(pulled.ops.map(o => (o as { id?: unknown } | null)?.id).filter(id => typeof id === "string"));
        if (this.relayed.some(id => back.has(id))) {
            this.relayed = this.relayed.filter(id => !back.has(id));
            await this.storage.setMeta("relayed", JSON.stringify(this.relayed));
        }
        const { added } = await this.importOps(pulled.ops);
        await this.storage.setMeta("cursors", JSON.stringify(rememberCursor(cursors, pulled.cursor)));
        if (!added) this.notify();   // outbox changed even if nothing new arrived
        return { sent, received: added };
    }

    private async saveOutbox(outbox: OpId[]) {
        this.outbox = outbox;
        await this.storage.setMeta("outbox", JSON.stringify(outbox));
    }

    // one cursor per node; a device from before that kept a single "cursor"
    private async loadCursors(): Promise<string[]> {
        const list = parseList(await this.storage.getMeta("cursors"));
        if (list.length) return list;
        const old = await this.storage.getMeta("cursor");
        return old ? [old] : [];
    }

    // merge ops from elsewhere (the node, or a bundle file)
    async importOps(input: unknown[]): Promise<{ added: number, rejected: number }> {
        const before = this.rejected.length;
        const incoming = this.accept(input);
        const known = new Set(this.ops.map(o => o.id));
        const fresh = incoming.filter(o => !known.has(o.id));
        if (fresh.length) await this.storage.appendOps(fresh);
        if (fresh.length || incoming.length) this.setOps(mergeOps(this.ops, incoming));
        return { added: fresh.length, rejected: this.rejected.length - before };
    }

    // "Save my work": everything this device made, including private notes and its media
    async exportBundle(): Promise<Bundle> {
        const mine = this.ops.filter(o => o.user === this.user);
        const media: Record<string, string> = {};
        for (const op of mine) {
            if (op.type === "document" && op.hash) {
                const data = await this.storage.getMedia(op.hash);
                if (data) media[op.hash] = data;
            }
        }
        return makeBundle(this.user, this.env.now(), mine, media);
    }

    async importBundle(input: unknown): Promise<{ added: number, rejected: number }> {
        const b = readBundle(input);
        if (!b.ok) throw new Error(b.reason);
        for (const [hash, data] of Object.entries(b.media)) await this.storage.putMedia(hash, data);
        return this.importOps(b.ops);
    }

    // ---- internals ----

    // create -> validate -> save -> update memory and notify. "Saved" means on disk first.
    private async commit(build: (ctx: OpContext) => Op[], count = 1): Promise<OpId> {
        if (count < 1) throw new Error("nothing to commit");
        // reserve counters before any await so two quick taps can't share an id
        const ctx: OpContext = { user: this.user, seq: this.seq + 1, timestamp: this.env.now() };
        this.seq += count;
        const ops = build(ctx);
        for (const op of ops) {
            const v = validateOp(op);
            if (!v.ok) throw new Error(`invalid ${op.type}: ${v.reason}`);
        }
        await this.storage.appendOps(ops);
        await this.storage.setMeta("seq", String(this.seq));
        // In memory before it's in the outbox: a sync that starts while the outbox is being
        // saved would otherwise find an id with no op, take it for an orphan, and drop it.
        const merged = mergeOps(this.ops, ops);
        this.ops = merged.ops;
        this.conflicts = merged.conflicts;
        const shareable = ops.filter(isShareable).map(o => o.id);
        if (shareable.length) {
            this.outbox = [...this.outbox, ...shareable];
            await this.storage.setMeta("outbox", JSON.stringify(this.outbox));
        }
        this.notify();
        return ops[0].id;
    }

    private accept(input: unknown[]): Op[] {
        const ops: Op[] = [];
        for (const item of input) {
            const v = validateOp(item);
            if (v.ok) ops.push(v.op);
            else this.rejected.push({ input: item, reason: v.reason });
        }
        return ops;
    }

    private setOps(result: { ops: Op[], conflicts: Conflict[] }) {
        this.ops = result.ops;
        this.conflicts = result.conflicts;
        this.notify();
    }

    private notify() {
        for (const fn of this.listeners) fn();
    }
}

// Collections whose latest access setting isn't "everyone can see". The node keeps their
// ops at the library and sends them only to the people they're for.
// Kept is restricted until its owner opens it up.
export function restrictedCollections(ops: Op[]): Set<CollectionId> {
    const latest = new Map<CollectionId, { timestamp: string, see: string }>();
    for (const op of ops) {
        if (!("collectionId" in op)) continue;
        if (op.type !== "collection-access") {
            if (!latest.has(op.collectionId)) latest.set(op.collectionId, { timestamp: "", see: isKept(op.collectionId) ? "owner" : "everyone" });
            continue;
        }
        const was = latest.get(op.collectionId);
        if (!was || op.timestamp >= was.timestamp) latest.set(op.collectionId, op);
    }
    return new Set([...latest].filter(([, a]) => a.see !== "everyone").map(([id]) => id));
}

// Splits ops into requests of at most `maxBytes` of JSON (as UTF-8), in order.
export function batches(ops: Op[], maxBytes: number): Op[][] {
    const out: Op[][] = [];
    let batch: Op[] = [], size = 2;
    for (const op of ops) {
        const n = utf8Length(JSON.stringify(op)) + 1;
        if (batch.length && size + n > maxBytes) { out.push(batch); batch = []; size = 2; }
        batch.push(op);
        size += n;
    }
    if (batch.length) out.push(batch);
    return out;
}

function utf8Length(s: string): number {
    let n = 0;
    for (let i = 0; i < s.length; i++) {
        const c = s.charCodeAt(i);
        if (c < 0x80) n += 1;
        else if (c < 0x800) n += 2;
        else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; }   // a surrogate pair is one 4-byte character
        else n += 3;
    }
    return n;
}

function parseList(raw: string | undefined): string[] {
    if (!raw) return [];
    try {
        const v: unknown = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
    } catch {
        return [];
    }
}
