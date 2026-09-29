import { test } from "node:test";
import assert from "node:assert/strict";
import { merge, validateOp, itemsView, threadView, collectionsView, collectionOps, makeBundle, readBundle } from "../src/contract.js";

const t = (n) => `2026-10-04T14:22:0${n}Z`;
const item = { id: "A:1", type: "item", author: "A", created: t(0), url: "https://x", properties: { title: "Corner store", author: "", type: "" } };
const c1 = { id: "B:1", type: "comment", author: "B", created: t(1), target: "A:1", body: "Dickinson St.", access: "public" };
const c2 = { id: "A:2", type: "comment", author: "A", created: t(2), target: "A:1", body: "mine", access: "private" };
const add = { id: "B:2", type: "add-to-collection", author: "B", created: t(3), target: "B/picnics", item: "A:1" };
const name1 = { id: "B:3", type: "name-collection", author: "B", created: t(4), target: "B/picnics", name: "Church picnics" };
const name2 = { id: "B:4", type: "name-collection", author: "B", created: t(5), target: "B/picnics", name: "Summer gatherings" };
const hijack = { id: "A:3", type: "name-collection", author: "A", created: t(6), target: "B/picnics", name: "Mine now" };
const all = [item, c1, c2, add, name1, name2, hijack];

test("fixtures are valid", () => all.forEach((op) => assert.equal(validateOp(op), null)));

test("merge is commutative, associative, idempotent", () => {
    const a = [item, c2, c1], b = [c1, add], c = [name1, name2, hijack];
    assert.deepEqual(merge(a, b), merge(b, a));
    assert.deepEqual(merge(merge(a, b), c), merge(a, merge(b, c)));
    const m = merge(a, b, c);
    assert.deepEqual(merge(m, a), m);
    assert.equal(m.length, 7);
});

test("views", () => {
    assert.deepEqual(itemsView(all).map((o) => o.id), ["A:1"]);
    assert.deepEqual(threadView(all, "A:1", "B").map((o) => o.id), ["B:1"]);
    assert.deepEqual(threadView(all, "A:1", "A").map((o) => o.id), ["B:1", "A:2"]);
    const hidden = [...all, { id: "M:1", type: "hide", author: "M", created: t(7), target: "B:1" }];
    assert.deepEqual(threadView(hidden, "A:1", "B"), []);
    assert.deepEqual(collectionsView(all), [{ id: "B/picnics", owner: "B", name: "Summer gatherings", items: ["A:1"] }]);
});

test("bundle round trip", () => {
    const ops = collectionOps(all, "B/picnics", "B");
    assert.ok(!ops.includes(c2), "other people's private notes stay home");
    const b = makeBundle(ops, []);
    assert.deepEqual(readBundle(JSON.stringify(b)), b);
    assert.throws(() => readBundle({ format: "osl-bundle", ops: [{ id: "x" }] }));
});
