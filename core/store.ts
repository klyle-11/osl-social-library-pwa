import {
    createAddToCollection, createAnnotation, createDescribe, createDocument, createHide, createNameCollection,
    createNameUser, createRemoveFromCollection, keptCollectionId, parseOpId, validateOp
} from "./ops";
import { mergeOps } from "./merge";
import { makeBundle, readBundle, type Bundle } from "./bundle";
import type { Access, CollectionId, Conflict, DescribeField, DocumentProperties, Op, OpContext, OpId } from "./types";

// One interface, one implementation per shell:
// MemoryStorage (tests), LocalStorageStorage (fast route), IndexedDBStorage (gate four).
export interface StorageAdapter {
    loadOps(): Promise<unknown[]>;              // unknown: everything is validated on the way in
    appendOps(ops: Op[]): Promise<void>;
    getMeta(key: string): Promise<string | undefined>;
    setMeta(key: string, value: string): Promise<void>;
    putMedia(hash: string, data: string): Promise<void>;
    getMedia(hash: string): Promise<string | undefined>;
}

// How ops move between this device and a node. HTTP now; a bundle file or radio later.
export interface Transport {
    pushOps(ops: Op[]): Promise<void>;
    pullOps(cursor: string): Promise<{ ops: unknown[], cursor: string }>;
    pushMedia(hash: string, data: string): Promise<void>;
}

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
    outbox: OpId[] = [];
    mediaOutbox: string[] = [];

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

    annotate(documentId: OpId, body: string, access: Access): Promise<OpId> {
        return this.commit(ctx => [createAnnotation(ctx, documentId, body, access)]);
    }

    // one tap: into this person's "Kept" collection
    keep(documentId: OpId): Promise<OpId> {
        return this.addToCollection(keptCollectionId(this.user), [documentId]);
    }

    unkeep(documentId: OpId): Promise<OpId> {
        return this.removeFromCollection(keptCollectionId(this.user), documentId);
    }

    // the new collection's id comes from this device's counter, so it can't collide
    async createCollection(name: string, documentIds: OpId[] = []): Promise<CollectionId> {
        let collectionId = "";
        await this.commit(ctx => {
            collectionId = `${ctx.user}/${ctx.seq}`;
            return [createNameCollection(ctx, collectionId, name)];
        });
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

    setName(name: string): Promise<OpId> {
        return this.commit(ctx => [createNameUser(ctx, name)]);
    }

    hide(target: OpId): Promise<OpId> {
        return this.commit(ctx => [createHide(ctx, target)]);
    }

    // fill in or correct a document's details: one op per changed field
    describe(documentId: OpId, changes: Partial<Record<DescribeField, string>>): Promise<OpId> {
        const fields = Object.entries(changes) as [DescribeField, string][];
        return this.commit(ctx => fields.map(([field, value], i) =>
            createDescribe({ ...ctx, seq: ctx.seq + i }, documentId, field, value)), fields.length);
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
            if (data) await transport.pushMedia(hash, data);
            this.mediaOutbox = this.mediaOutbox.filter(h => h !== hash);
            await this.storage.setMeta("mediaOutbox", JSON.stringify(this.mediaOutbox));
        }

        const sending = [...this.outbox];
        const byId = new Map(this.ops.map(o => [o.id, o]));
        const ops = sending.map(id => byId.get(id)).filter((o): o is Op => !!o);
        if (ops.length) await transport.pushOps(ops);
        // only clear what was sent; anything committed meanwhile stays queued
        this.outbox = this.outbox.filter(id => !sending.includes(id));
        await this.storage.setMeta("outbox", JSON.stringify(this.outbox));

        const cursor = (await this.storage.getMeta("cursor")) ?? "";
        const pulled = await transport.pullOps(cursor);
        const { added } = await this.importOps(pulled.ops);
        await this.storage.setMeta("cursor", pulled.cursor);
        if (!added) this.notify();   // outbox changed even if nothing new arrived
        return { sent: ops.length, received: added };
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
        const shareable = ops.filter(isShareable).map(o => o.id);
        if (shareable.length) {
            this.outbox = [...this.outbox, ...shareable];
            await this.storage.setMeta("outbox", JSON.stringify(this.outbox));
        }
        this.setOps(mergeOps(this.ops, ops));
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

function parseList(raw: string | undefined): string[] {
    if (!raw) return [];
    try {
        const v: unknown = JSON.parse(raw);
        return Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : [];
    } catch {
        return [];
    }
}
