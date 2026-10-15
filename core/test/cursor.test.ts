import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCursor, positionFor, rememberCursor, MAX_CURSORS } from "../cursor";

test("a node reads its own cursor out of the list", () => {
    assert.equal(positionFor("lib.12,drop-a1.3", "lib", 20), 12);
    assert.equal(positionFor("lib.12,drop-a1.3", "drop-a1", 20), 3);
    assert.equal(positionFor("lib.12", "other", 20), 0);
    assert.equal(positionFor("", "lib", 20), 0);
});

test("a cursor past the end of the log (a clean start under the same id) reads from 0", () => {
    assert.equal(positionFor("lib.57", "lib", 3), 0);
});

test("old and malformed cursors read from 0", () => {
    assert.equal(positionFor("57", "lib", 100), 0);
    assert.equal(positionFor("lib.-1,lib.x", "lib", 100), 0);
    assert.equal(parseCursor("a.b.7")?.log, "a.b");
});

test("remembering keeps one per node, newest first, and a bounded number", () => {
    let list = rememberCursor([], "lib.1");
    list = rememberCursor(list, "drop-a.4");
    list = rememberCursor(list, "lib.9");
    assert.deepEqual(list, ["lib.9", "drop-a.4"]);
    for (let i = 0; i < 20; i++) list = rememberCursor(list, `n${i}.1`);
    assert.equal(list.length, MAX_CURSORS);
    assert.deepEqual(rememberCursor(list, "nonsense"), list);
});
