import { test } from "node:test";
import assert from "node:assert/strict";
import { LibraryStore, type Transport } from "../store";
import { MemoryStorage } from "../../adapters/memory-storage";
import { buildViews } from "../views";
import { validateOp } from "../ops";
import type { Op } from "../types";
import catalog from "../../library/catalog.json";

function env(id: string) {
    let t = Date.parse("2026-10-04T12:00:00Z");
    return { now: () => new Date(t += 1000).toISOString(), newDeviceId: () => id };
}

// an in-memory node: arrival-ordered log, cursor = position
function fakeNode(): Transport & { log: Op[] } {
    const log: Op[] = [];
    return {
        log,
        async pushOps(ops) { for (const op of ops) if (!log.some(o => o.id === op.id)) log.push(op); },
        async pullOps(cursor) { return { ops: log.slice(Number(cursor) || 0), cursor: String(log.length) }; },
        async pushMedia() {}
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
        async pushMedia() {}
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
