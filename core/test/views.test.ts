import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeOps } from "../merge";
import { buildViews } from "../views";
import type { Op } from "../types";
import phoneA from "../fixtures/phone-a.json";
import phoneB from "../fixtures/phone-b.json";
import phoneC from "../fixtures/phone-c.json";

const all = mergeOps(phoneA as Op[], phoneB as Op[], phoneC as Op[]).ops;
const view = (ops: Op[], viewer = "d-a", stewards: string[] = []) => buildViews(ops, { viewer, stewards });

test("annotation thread is the document's annotations, oldest first", () => {
    const t = view(all).threads["d-a:1"].map(a => a.op.body);
    assert.deepEqual(t, ["That's the corner store on Dickinson Street.", "My aunt worked there."]);
});

test("renaming a collection shows the later name; a non-owner can't rename it", () => {
    assert.equal(view(all).collections["d-c/1"].name, "Summer gatherings");
});

test("kept collection is named Kept and holds the document", () => {
    const c = view(all).collections["d-b/kept"];
    assert.equal(c.name, "Kept");
    assert.deepEqual(c.documentIds, ["d-a:1"]);
});

test("names are last-writer-wins per user", () => {
    assert.equal(view(all).names["d-b"], "Rosa");
});

test("removing from a collection wins over an earlier add", () => {
    const remove: Op = { id: "d-b:4", user: "d-b", timestamp: "2026-10-04T16:00:00Z", type: "remove-from-collection", collectionId: "d-b/kept", documentId: "d-a:1" };
    const v = view([...all, remove]);
    assert.deepEqual(v.collections["d-b/kept"].documentIds, []);
    assert.equal(v.feed.some(e => e.kind === "collect" && e.op.collectionId === "d-b/kept"), false);
});

test("private annotations are only visible to their author", () => {
    const secret: Op = { id: "d-b:5", user: "d-b", timestamp: "2026-10-04T16:00:00Z", type: "annotation", target: "d-a:1", body: "note to self", access: "private" };
    assert.equal(view([...all, secret], "d-a").threads["d-a:1"].length, 2);
    assert.equal(view([...all, secret], "d-b").threads["d-a:1"].length, 3);
    assert.equal(view([...all, secret], "d-b").feed.some(e => e.op.id === "d-b:5"), false);
});

test("hide: the author or a steward can hide; anyone else can't", () => {
    const byOther: Op = { id: "d-c:9", user: "d-c", timestamp: "2026-10-04T17:00:00Z", type: "hide", target: "d-b:1" };
    assert.equal(view([...all, byOther]).threads["d-a:1"].length, 2);
    assert.equal(view([...all, byOther], "d-a", ["d-c"]).threads["d-a:1"].length, 1);
    const hideDoc: Op = { id: "d-a:10", user: "d-a", timestamp: "2026-10-04T17:00:00Z", type: "hide", target: "d-a:1" };
    const v = view([...all, hideDoc]);
    assert.equal(v.documents["d-a:1"], undefined);
    assert.equal(v.feed.length, 1);   // only the collection-started entry is left
});

test("feed is newest first and identical in any merge order", () => {
    const v1 = view(mergeOps(phoneC as Op[], phoneB as Op[], phoneA as Op[]).ops);
    const v2 = view(all);
    assert.deepEqual(v1.feed.map(e => e.op.id), v2.feed.map(e => e.op.id));
    const times = v2.feed.map(e => e.op.timestamp);
    assert.deepEqual(times, [...times].sort().reverse());
});

const describe = (id: string, user: string, timestamp: string, field: string, value: string) =>
    ({ id, user, timestamp, type: "describe", target: "d-a:1", field, value }) as Op;

test("details filled in later: the latest wins per field, and the adder is credited", () => {
    const ops = [...all,
        describe("d-b:90", "d-b", "2026-10-05T10:00:00Z", "year", "1961"),
        describe("d-c:90", "d-c", "2026-10-05T11:00:00Z", "year", "1962"),
        describe("d-c:91", "d-c", "2026-10-05T11:00:01Z", "author", "Unknown photographer")];
    const v = view(ops);
    assert.equal(v.documents["d-a:1"].properties.year, "1962");
    assert.equal(v.documents["d-a:1"].properties.author, "Unknown photographer");
    assert.equal(v.credits["d-a:1"].year?.user, "d-c");
    // the original op is untouched, so it still merges as the same op everywhere
    assert.equal(all.find(o => o.id === "d-a:1" && o.type === "document" && o.properties.year), undefined);
});

test("a hidden detail falls back to what was there before", () => {
    const ops = [...all,
        describe("d-b:90", "d-b", "2026-10-05T10:00:00Z", "year", "1961"),
        describe("d-c:90", "d-c", "2026-10-05T11:00:00Z", "year", "nonsense"),
        { id: "s:1", user: "s", timestamp: "2026-10-05T12:00:00Z", type: "hide", target: "d-c:90" } as Op];
    assert.equal(view(ops, "d-a", ["s"]).documents["d-a:1"].properties.year, "1961");
});
