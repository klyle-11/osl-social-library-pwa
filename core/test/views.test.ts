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

// who may edit a document's details: the uploader (d-a) decides
test("details: open to everyone until the uploader says otherwise", () => {
    const v = view([...all, describe("d-b:80", "d-b", "2026-10-05T10:00:00Z", "year", "1961")]);
    assert.equal(v.documents["d-a:1"].properties.year, "1961");
});

test("details: once the uploader keeps them, others' later edits are ignored, earlier ones stand", () => {
    const v = view([...all,
        describe("d-b:80", "d-b", "2026-10-05T10:00:00Z", "year", "1961"),
        describe("d-a:80", "d-a", "2026-10-05T11:00:00Z", "editors", "owner"),
        describe("d-b:81", "d-b", "2026-10-05T12:00:00Z", "year", "1999"),
        describe("d-a:81", "d-a", "2026-10-05T13:00:00Z", "description", "line one\nline two")]);
    const p = v.documents["d-a:1"].properties;
    assert.equal(p.year, "1961");
    assert.equal(p.description, "line one\nline two");
    assert.equal(v.feed.some(e => e.kind === "describe" && e.op.id === "d-b:81"), false);
});

test("details: only the uploader or a steward may change who can edit", () => {
    const grab = describe("d-b:80", "d-b", "2026-10-05T11:00:00Z", "editors", "owner");
    assert.equal(view([...all, grab]).documents["d-a:1"].properties.editors, undefined);
    assert.equal(view([...all, grab], "d-a", ["d-b"]).documents["d-a:1"].properties.editors, "owner");
});

test("details: chosen people may edit, others may not; the uploader can open it up again", () => {
    const v = view([...all,
        describe("d-a:80", "d-a", "2026-10-05T11:00:00Z", "editors", "people:d-c"),
        describe("d-b:80", "d-b", "2026-10-05T12:00:00Z", "year", "1999"),
        describe("d-c:80", "d-c", "2026-10-05T12:00:01Z", "author", "Ama"),
        describe("d-a:81", "d-a", "2026-10-05T13:00:00Z", "editors", "everyone"),
        describe("d-b:81", "d-b", "2026-10-05T14:00:00Z", "subtitle", "Now open")]);
    const p = v.documents["d-a:1"].properties;
    assert.equal(p.year, undefined);
    assert.equal(p.author, "Ama");
    assert.equal(p.subtitle, "Now open");
});

test("details: a kept document still takes its first thumbnail from anyone, but not a replacement", () => {
    const hash = (c: string) => "sha256-" + c.repeat(64);
    const v = view([...all,
        describe("d-a:80", "d-a", "2026-10-05T11:00:00Z", "editors", "owner"),
        describe("d-b:80", "d-b", "2026-10-05T12:00:00Z", "thumbnail", hash("b")),
        describe("d-c:80", "d-c", "2026-10-05T12:00:01Z", "thumbnail", hash("c"))]);
    assert.equal(v.documents["d-a:1"].properties.thumbnail, hash("b"));
});

test("details: a malformed who-can-edit is ignored", () => {
    const v = view([...all, describe("d-a:80", "d-a", "2026-10-05T11:00:00Z", "editors", "nobody?")]);
    assert.equal(v.documents["d-a:1"].properties.editors, undefined);
});

// replies
const note = (id: string, user: string, timestamp: string, body: string, replyTo?: string, access = "public") =>
    ({ id, user, timestamp, type: "annotation", target: "d-a:1", body, access, ...(replyTo && { replyTo }) }) as Op;

test("replies sit under the note they answer, oldest first at each level", () => {
    const v = view([...all,
        note("d-b:70", "d-b", "2026-10-05T10:00:00Z", "Question?"),
        note("d-c:70", "d-c", "2026-10-05T10:05:00Z", "Answer", "d-b:70"),
        note("d-a:70", "d-a", "2026-10-05T10:06:00Z", "Unrelated"),
        note("d-b:71", "d-b", "2026-10-05T10:07:00Z", "Thanks", "d-c:70"),
        note("d-a:71", "d-a", "2026-10-05T10:08:00Z", "Another answer", "d-b:70")]);
    const t = v.threads["d-a:1"].filter(a => a.op.id.endsWith(":70") || a.op.id.endsWith(":71"));
    assert.deepEqual(t.map(a => [a.op.body, a.depth]),
        [["Question?", 0], ["Answer", 1], ["Thanks", 2], ["Another answer", 1], ["Unrelated", 0]]);
    assert.equal(t[1].parent?.id, "d-b:70");
});

test("a reply to a hidden or someone else's private note stands on its own", () => {
    const v = view([...all,
        note("d-b:70", "d-b", "2026-10-05T10:00:00Z", "secret", undefined, "private"),
        note("d-c:70", "d-c", "2026-10-05T10:05:00Z", "reply to secret", "d-b:70"),
        note("d-c:71", "d-c", "2026-10-05T10:06:00Z", "reply to nothing", "d-x:1")], "d-a");
    const t = v.threads["d-a:1"];
    assert.equal(t.some(a => a.op.body === "secret"), false);
    assert.deepEqual(t.filter(a => a.op.body.startsWith("reply")).map(a => [a.depth, a.parent]), [[0, null], [0, null]]);
});

test("a loop of replies doesn't hang or lose notes", () => {
    const v = view([...all,
        note("d-b:70", "d-b", "2026-10-05T10:00:00Z", "one", "d-c:70"),
        note("d-c:70", "d-c", "2026-10-05T10:05:00Z", "two", "d-b:70")]);
    assert.equal(v.threads["d-a:1"].filter(a => a.op.body === "one" || a.op.body === "two").length, 2);
});
