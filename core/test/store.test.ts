import { test } from "node:test";
import assert from "node:assert/strict";
import { LibraryStore, PUSH_BATCH_BYTES, batches, type Transport } from "../store";
import { positionFor } from "../cursor";
import { MemoryStorage } from "../../adapters/memory-storage";
import { buildViews } from "../views";
import { validateOp } from "../ops";
import type { Op } from "../types";
import catalog from "../../library/catalog.json";

function env(id: string) {
    let t = Date.parse("2026-10-04T12:00:00Z");
    return { now: () => new Date(t += 1000).toISOString(), newDeviceId: () => id };
}

// an in-memory library node: arrival-ordered log, cursor = "<log id>.<position>"
function fakeNode(logId = "lib"): Transport & { log: Op[], media: string[] } {
    const log: Op[] = [];
    const media: string[] = [];
    return {
        log, media,
        async pushOps(ops) {
            for (const op of ops) if (!log.some(o => o.id === op.id)) log.push(op);
            return { keep: [], role: "library" };
        },
        async pullOps(after) {
            return { ops: log.slice(positionFor(after, logId, log.length)), cursor: `${logId}.${log.length}` };
        },
        async pushMedia(hash) { media.push(hash); return true; }
    };
}

// a drop point: takes ops into an inbox, takes no files, hands out only what came from the library
function fakeDropPoint(opts: { keepIds?: string[] } = {}): Transport & { inbox: Op[], fromLibrary: Op[], pushes: number[] } {
    const inbox: Op[] = [], fromLibrary: Op[] = [], pushes: number[] = [];
    return {
        inbox, fromLibrary, pushes,
        async pushOps(ops) {
            pushes.push(ops.length);
            const keep = ops.map(o => o.id).filter(id => opts.keepIds?.includes(id));
            for (const op of ops) if (!keep.includes(op.id) && !inbox.some(o => o.id === op.id)) inbox.push(op);
            return { keep, role: "droppoint" };
        },
        async pullOps(after) {
            return { ops: fromLibrary.slice(positionFor(after, "drop-1", fromLibrary.length)), cursor: `drop-1.${fromLibrary.length}` };
        },
        async pushMedia() { return false; }
    };
}

test("the catalog is valid", () => {
    for (const op of catalog.ops) assert.ok(validateOp(op).ok, JSON.stringify(op));
});

test("the counter survives a reopen, so ids never repeat", async () => {
    const storage = new MemoryStorage();
    const s1 = new LibraryStore(storage, env("d-x"));
    await s1.open();
    await s1.setName("A");
    await s1.setName("B");
    const s2 = new LibraryStore(storage, env("d-other"));
    await s2.open();
    assert.equal(s2.user, "d-x");
    const id = await s2.setName("C");
    assert.equal(id, "d-x:3");
});

test("seed merges every open without being stored or doubled", async () => {
    const storage = new MemoryStorage();
    for (let i = 0; i < 2; i++) {
        const s = new LibraryStore(storage, env("d-x"));
        await s.open(catalog.ops);
        assert.equal(s.ops.length, catalog.ops.length);
    }
    assert.equal(storage.ops.length, 0);
});

test("two phones sync through a node and see the same library", async () => {
    const node = fakeNode();
    const a = new LibraryStore(new MemoryStorage(), env("d-a"));
    const b = new LibraryStore(new MemoryStorage(), env("d-b"));
    await a.open(catalog.ops);
    await b.open(catalog.ops);

    await a.keep("steward:1");
    await a.annotate("steward:1", "hello from a", "public");
    await a.annotate("steward:1", "just for me", "private");
    const col = await b.createCollection("Poems", ["steward:2"]);
    assert.equal(a.outbox.length, 2, "private note is not queued");

    await a.sync(node);
    await b.sync(node);
    await a.sync(node);
    await b.sync(node);   // repeating changes nothing

    assert.equal(a.outbox.length, 0);
    assert.equal(node.log.length, 4);
    assert.equal(node.log.some(o => o.type === "annotation" && o.access === "private"), false);

    const va = buildViews(a.ops, { viewer: "d-a", stewards: [] });
    const vb = buildViews(b.ops, { viewer: "d-b", stewards: [] });
    assert.equal(vb.threads["steward:1"].length, 1);
    assert.equal(va.threads["steward:1"].length, 2);
    assert.equal(va.collections[col].name, "Poems");
    assert.deepEqual(va.feed.filter(e => e.op.user !== "d-a").map(e => e.op.id), vb.feed.filter(e => e.op.user !== "d-a").map(e => e.op.id));
});

test("a failed push keeps everything queued", async () => {
    const s = new LibraryStore(new MemoryStorage(), env("d-a"));
    await s.open();
    await s.keep("steward:1");
    const broken: Transport = {
        async pushOps() { throw new Error("offline"); },
        async pullOps(c) { return { ops: [], cursor: c }; },
        async pushMedia() { return true; }
    };
    await assert.rejects(s.sync(broken));
    assert.equal(s.outbox.length, 1);
});

test("save my work -> load on a fresh phone restores it", async () => {
    const a = new LibraryStore(new MemoryStorage(), env("d-a"));
    await a.open();
    await a.putMedia("sha256-" + "0".repeat(64), "data:image/jpeg;base64,AAAA");
    await a.addDocument({ fileType: "image/jpeg", hash: "sha256-" + "0".repeat(64), properties: { title: "Photo", author: "", type: "photo" } });
    await a.annotate("d-a:1", "private thought", "private");
    const bundle = JSON.parse(JSON.stringify(await a.exportBundle()));

    const fresh = new LibraryStore(new MemoryStorage(), env("d-a"));
    await fresh.open();
    const r = await fresh.importBundle(bundle);
    assert.equal(r.added, 2);
    assert.equal(await fresh.getMedia("sha256-" + "0".repeat(64)), "data:image/jpeg;base64,AAAA");
    await assert.rejects(fresh.importBundle({ format: "something-else" }));
});

test("invalid ops from outside are rejected, not merged", async () => {
    const s = new LibraryStore(new MemoryStorage(), env("d-a"));
    await s.open();
    const r = await s.importOps([{ id: "x", type: "annotation" }, { id: "d-z:1", user: "d-q", type: "hide", target: "a", timestamp: "2026-10-04T12:00:00Z" }]);
    assert.equal(r.added, 0);
    assert.equal(r.rejected, 2);
});

const PHOTO = "sha256-" + "1".repeat(64);

test("at a drop point: notes go, a photo and its document wait for the library", async () => {
    const s = new LibraryStore(new MemoryStorage(), env("d-a"));
    await s.open();
    await s.putMedia(PHOTO, "data:image/jpeg;base64,AAAA");
    const photoDoc = await s.addDocument({ fileType: "image/jpeg", hash: PHOTO, properties: { title: "Corner store", author: "", type: "photo" } });
    const note = await s.annotate("steward:1", "written out in the field", "public");

    const drop = fakeDropPoint();
    await s.sync(drop);
    assert.deepEqual(drop.inbox.map(o => o.id), [note]);
    assert.deepEqual(s.outbox, [photoDoc], "the photo's document waits with the photo");
    assert.deepEqual(s.mediaOutbox, [PHOTO]);
    assert.deepEqual(s.relayed, [note], "the note is at the drop point, on its way");

    // the library sends the note back out to the drop point: it has arrived
    drop.fromLibrary.push(drop.inbox[0]);
    await s.sync(drop);
    assert.deepEqual(s.relayed, []);

    // at the library: the photo goes first, then its document
    const lib = fakeNode();
    await s.sync(lib);
    assert.deepEqual(lib.media, [PHOTO]);
    assert.deepEqual(lib.log.map(o => o.id), [photoDoc]);
    assert.deepEqual(s.outbox, []);
});

test("an op a drop point leaves with the phone stays in the outbox", async () => {
    const s = new LibraryStore(new MemoryStorage(), env("d-a"));
    await s.open();
    const a = await s.annotate("steward:1", "one", "public");
    const b = await s.annotate("steward:1", "two", "public");
    await s.sync(fakeDropPoint({ keepIds: [b] }));
    assert.deepEqual(s.outbox, [b]);
    assert.deepEqual(s.relayed, [a]);
});

test("pushes are batched by size, and a lone big op still goes", async () => {
    const s = new LibraryStore(new MemoryStorage(), env("d-a"));
    await s.open();
    for (let i = 0; i < 30; i++) await s.annotate("steward:1", "x".repeat(600), "public");
    const drop = fakeDropPoint();
    await s.sync(drop);
    assert.ok(drop.pushes.length > 1, `${drop.pushes.length} requests`);
    assert.equal(drop.pushes.reduce((a, b) => a + b, 0), 30);
    assert.equal(s.outbox.length, 0);

    const big = { id: "d-a:99", type: "annotation", user: "d-a", timestamp: "2026-10-04T12:00:00Z", target: "x", body: "é".repeat(5000), access: "public" } as Op;
    assert.deepEqual(batches([big], PUSH_BATCH_BYTES).map(b => b.length), [1]);
});

test("one cursor per node: moving between the library and a drop point re-reads neither", async () => {
    const s = new LibraryStore(new MemoryStorage(), env("d-a"));
    await s.open();
    const lib = fakeNode();
    const other = new LibraryStore(new MemoryStorage(), env("d-b"));
    await other.open();
    await other.annotate("steward:1", "from b", "public");
    await other.sync(lib);

    let asked: string[] = [];
    const spy = (t: Transport): Transport => ({ ...t, pullOps: c => { asked.push(c); return t.pullOps(c); } });
    await s.sync(spy(lib));
    await s.sync(spy(fakeDropPoint()));
    await s.sync(spy(lib));
    assert.deepEqual(asked, ["", "lib.1", "drop-1.0,lib.1"]);
});

test("an op committed while a sync starts is still sent (storage that takes its time)", async () => {
    // IndexedDB saves in a later task, so a sync can start while a commit is saving the outbox
    class SlowStorage extends MemoryStorage {
        hold: Promise<void> | null = null;
        override async setMeta(key: string, value: string) {
            if (key === "outbox" && this.hold) await this.hold;
            return super.setMeta(key, value);
        }
    }
    const storage = new SlowStorage();
    const store = new LibraryStore(storage, env("d-slow"));
    await store.open();
    const node = fakeNode();
    let release!: () => void;
    storage.hold = new Promise(r => { release = r; });
    const committing = store.annotate("steward:1", "sent in the middle", "public");
    await new Promise(r => setTimeout(r, 0));      // the commit is now waiting on the outbox
    const syncing = store.sync(node);              // and a sync starts
    release();
    storage.hold = null;
    await committing;
    await syncing;
    await store.sync(node);
    assert.deepEqual(node.log.map(o => o.type === "annotation" && o.body), ["sent in the middle"]);
    assert.deepEqual(store.outbox, []);
});

test("erasing what was taken back: the words go from this device's own copy, and a removed upload's file", async () => {
    const storage = new MemoryStorage();
    const store = new LibraryStore(storage, env("d-me"));
    await store.open();
    const doc = await store.addDocument({ fileType: "image/jpeg", hash: "sha256-" + "a".repeat(64), properties: { title: "Photo", author: "", type: "photo" } });
    await store.putMedia("sha256-" + "a".repeat(64), "data:image/jpeg;base64,AAAA");
    const note = await store.annotate(doc, "something to take back", "public");
    await store.redact(note, "strike");
    await store.redact(doc, "remove");
    await store.purge([note, doc]);
    const stored = new Map((await storage.loadOps() as Op[]).map(o => [o.id, o]));
    assert.equal((stored.get(note) as { body: string }).body, "***");
    assert.equal((stored.get(doc) as { hash?: string }).hash, undefined);
    assert.equal(await storage.getMedia("sha256-" + "a".repeat(64)), undefined);
    assert.equal(store.mediaOutbox.length, 0);
    assert.equal(JSON.stringify(store.ops).includes("something to take back"), false);
    // reopened from storage, it's still gone
    const again = new LibraryStore(storage, env("d-me"));
    await again.open();
    assert.equal(JSON.stringify(again.ops).includes("something to take back"), false);
});
