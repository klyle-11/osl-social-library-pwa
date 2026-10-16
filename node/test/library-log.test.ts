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
