import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LibraryLog } from "../library-log";
import type { Identity, Op } from "../../core/types";

const at = (m: number) => `2026-10-06T10:${String(m).padStart(2, "0")}:00Z`;
const op = (o: Record<string, unknown>) => o as Op;
const identity: Identity = { devices: { "d-a": "a-ama", "d-b": "a-rosa" }, groups: { "g-club": ["a-rosa"] } };

function fresh() {
    const dir = mkdtempSync(join(tmpdir(), "osl-log-"));
    const log = new LibraryLog({ log: join(dir, "ops.jsonl"), logId: join(dir, "log-id"), conflicts: join(dir, "conflicts.jsonl") });
    return { log, done: () => { log.close(); rmSync(dir, { recursive: true, force: true }); } };
}

const ops = [
    op({ id: "d-a:1", user: "d-a", timestamp: at(1), type: "name-collection", collectionId: "a-ama/1", name: "Diary" }),
    op({ id: "d-a:2", user: "d-a", timestamp: at(2), type: "collection-access", collectionId: "a-ama/1", see: "people:g-club", add: "owner" }),
    op({ id: "d-a:3", user: "d-a", timestamp: at(3), type: "add-to-collection", collectionId: "a-ama/1", documentId: "x:1" }),
    op({ id: "d-a:4", user: "d-a", timestamp: at(4), type: "name-collection", collectionId: "a-ama/2", name: "Open shelf" })
];

test("a collection that isn't for everyone is left out for everyone it isn't for", () => {
    const { log, done } = fresh();
    log.accept(ops);
    const sent = (viewer: string | null) => log.log.filter(o => !log.notFor(viewer, identity)(o)).map(o => o.id);
    assert.deepEqual(sent(null), ["d-a:2", "d-a:4"]);            // the access op itself goes to everyone
    assert.deepEqual(sent("a-rosa"), ["d-a:1", "d-a:2", "d-a:3", "d-a:4"]);
    assert.deepEqual(sent("a-ama"), ["d-a:1", "d-a:2", "d-a:3", "d-a:4"]);
    assert.deepEqual(sent("a-other"), ["d-a:2", "d-a:4"]);
    assert.deepEqual(log.sharedWith("a-rosa", identity).map(o => o.id), ["d-a:1", "d-a:3"]);
    assert.deepEqual(log.sharedWith("a-other", identity), []);
    done();
});

test("only the owner's access setting counts", () => {
    const { log, done } = fresh();
    log.accept([...ops, op({ id: "d-b:1", user: "d-b", timestamp: at(9), type: "collection-access", collectionId: "a-ama/1", see: "everyone", add: "everyone" })]);
    assert.equal(log.notFor(null, identity)(ops[2]), true);
    done();
});

test("a rule can refuse an op, and says which, or leave it with the phone", () => {
    const { log, done } = fresh();
    const r = log.accept(ops, o => o.id === "d-a:3" ? "not here" : o.id === "d-a:4" ? { keep: "later" } : null);
    assert.equal(r.added, 2);
    assert.deepEqual(r.refused, [{ id: "d-a:3", reason: "not here" }]);
    assert.deepEqual(r.keep, ["d-a:4"]);
    assert.equal(log.accessRevision, 1);
    done();
});

test("Kept is sent only to its owner, and to the library's admins", () => {
    const { log, done } = fresh();
    log.accept([op({ id: "d-a:20", user: "d-a", timestamp: at(20), type: "add-to-collection", collectionId: "a-ama/kept", documentId: "x:1" })]);
    const kept = log.log[0];
    assert.equal(log.notFor("a-ama", identity)(kept), false);
    assert.equal(log.notFor("a-rosa", identity)(kept), true);
    assert.equal(log.notFor(null, identity)(kept), true);              // nor by radio
    assert.equal(log.notFor("a-rosa", identity, true)(kept), false);   // an admin
    assert.deepEqual(log.sharedWith("a-rosa", identity, true).map(o => o.id), ["d-a:20"]);
    done();
});

test("taking back: the words leave the file, a removed upload's file is freed, and neither comes back", async () => {
    const { readFileSync } = await import("node:fs");
    const dir = mkdtempSync(join(tmpdir(), "osl-log-"));
    const paths = { log: join(dir, "ops.jsonl"), logId: join(dir, "log-id"), conflicts: join(dir, "conflicts.jsonl"), origins: join(dir, "origins.jsonl"), takenDown: join(dir, "taken-down.json") };
    const log = new LibraryLog(paths);
    const hash = "sha256-" + "b".repeat(64);
    log.accept([
        op({ id: "d-a:1", user: "d-a", timestamp: at(1), type: "document", fileType: "image/jpeg", hash, properties: { title: "Photo", author: "", type: "photo" } }),
        op({ id: "d-a:2", user: "d-a", timestamp: at(2), type: "annotation", target: "d-a:1", body: "words to take back", access: "public" })
    ], undefined, "10.0.0.5");
    assert.equal(log.origins.get("d-a:2"), "10.0.0.5");
    log.accept([
        op({ id: "s:1", user: "s", timestamp: at(3), type: "redact", target: "d-a:2", mode: "strike" }),
        op({ id: "s:2", user: "s", timestamp: at(4), type: "redact", target: "d-a:1", mode: "remove" })
    ]);
    const text = readFileSync(paths.log, "utf8");
    assert.equal(text.includes("words to take back"), false);
    assert.equal(text.includes(hash), false);
    assert.deepEqual(log.takeFreed(), [hash]);
    assert.equal(log.takenDown.has(hash), true);
    // an old phone sends the original again: taken as a duplicate, nothing written
    const r = log.accept([op({ id: "d-a:2", user: "d-a", timestamp: at(2), type: "annotation", target: "d-a:1", body: "words to take back", access: "public" })]);
    assert.equal(r.duplicates, 1);
    assert.equal(readFileSync(paths.log, "utf8").includes("words to take back"), false);
    log.close();
    // and after a restart, still gone, still taken down, appending still works
    const again = new LibraryLog(paths);
    assert.equal(JSON.stringify(again.log).includes("words to take back"), false);
    assert.equal(again.takenDown.has(hash), true);
    assert.equal(again.redacted.get("d-a:1"), "remove");
    again.accept([op({ id: "d-a:3", user: "d-a", timestamp: at(5), type: "annotation", target: "d-a:1", body: "after", access: "public" })]);
    assert.equal(new LibraryLog(paths).log.length, 5);
    again.close();
    rmSync(dir, { recursive: true, force: true });
});
