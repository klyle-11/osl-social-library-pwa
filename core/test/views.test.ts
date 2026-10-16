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

// d-a uploaded d-a:1; notes on it: d-b's and d-c's (see the fixtures)
const pin = (id: string, user: string, value: string, minute = 30): Op =>
    ({ id, user, timestamp: `2026-10-04T17:${String(minute).padStart(2, "0")}:00Z`, type: "describe", target: "d-a:1", field: "prompts", value } as Op);

test("the uploader's pinned notes become the document's prompts, in the order pinned", () => {
    const notes = view(all).threads["d-a:1"].map(a => a.op.id);
    const v = view([...all, pin("d-a:90", "d-a", `${notes[1]},${notes[0]},${notes[1]}`)]);
    assert.deepEqual(v.prompts["d-a:1"].map(n => n.id), [notes[1], notes[0]]);
    assert.equal(v.feed.some(e => e.kind === "describe" && e.op.field === "prompts"), false);   // a setting, not a contribution
    assert.equal(v.credits["d-a:1"]?.prompts, undefined);
});

test("only the uploader or a steward can pin; anyone else's pins are ignored", () => {
    const notes = view(all).threads["d-a:1"].map(a => a.op.id);
    assert.equal(view([...all, pin("d-b:90", "d-b", notes[0])]).prompts["d-a:1"], undefined);
    assert.deepEqual(view([...all, pin("s:90", "s", notes[0])], "d-a", ["s"]).prompts["d-a:1"].map(n => n.id), [notes[0]]);
});

test("a private or hidden note is never a prompt, and unpinning clears them", () => {
    const secret: Op = { id: "d-a:91", user: "d-a", timestamp: "2026-10-04T17:00:00Z", type: "annotation", target: "d-a:1", body: "mine only", access: "private" };
    const notes = view(all).threads["d-a:1"].map(a => a.op.id);
    const hide: Op = { id: "d-a:92", user: "d-a", timestamp: "2026-10-04T17:10:00Z", type: "hide", target: notes[0] };
    const v = view([...all, secret, hide, pin("d-a:93", "d-a", `d-a:91,${notes[0]},${notes[1]}`)]);
    assert.deepEqual(v.prompts["d-a:1"].map(n => n.id), [notes[1]]);
    assert.equal(view([...all, pin("d-a:93", "d-a", notes[1]), pin("d-a:94", "d-a", "", 40)]).prompts["d-a:1"], undefined);
});

// ---- people across devices, and who may see and add to a collection ----

const at = (minute: number) => `2026-10-06T10:${String(minute).padStart(2, "0")}:00Z`;
const op = (o: Record<string, unknown>) => o as Op;
// d-a and d-x are both Ama's account a-ama; d-b is Rosa's a-rosa; d-c is a guest.
// The fixtures have one document (d-a:1); here are two more.
const doc = (id: string): Op => op({ id, user: "s", timestamp: "2026-10-04T13:00:00Z", type: "document", fileType: "text", properties: { title: id, author: "", type: "" } });
const shelf = [...all, doc("s:1"), doc("s:2")];
const identity = { devices: { "d-a": "a-ama", "d-x": "a-ama", "d-b": "a-rosa" }, groups: { "g-club": ["a-rosa"] } };
const idView = (ops: Op[], viewer: string, stewards: string[] = []) => buildViews(ops, { viewer, stewards, identity });
const access = (id: string, user: string, collectionId: string, see: string, add: string, minute: number) =>
    op({ id, user, timestamp: at(minute), type: "collection-access", collectionId, see, add });
const add = (id: string, user: string, collectionId: string, documentId: string, minute: number) =>
    op({ id, user, timestamp: at(minute), type: "add-to-collection", collectionId, documentId });
const remove = (id: string, user: string, collectionId: string, documentId: string, minute: number) =>
    op({ id, user, timestamp: at(minute), type: "remove-from-collection", collectionId, documentId });
const named = (id: string, user: string, collectionId: string, name: string, minute: number) =>
    op({ id, user, timestamp: at(minute), type: "name-collection", collectionId, name });

test("an account's devices are one person: one Kept, and each other's notes are 'mine'", () => {
    const v = idView([...shelf, add("d-x:1", "d-x", "a-ama/kept", "d-a:1", 1), add("d-a:50", "d-a", "a-ama/kept", "d-a:1", 2)], "d-x");
    assert.deepEqual(v.collections["a-ama/kept"].documentIds, ["d-a:1"]);
    assert.equal(v.collections["a-ama/kept"].mine, true);
    const note: Op = op({ id: "d-a:51", user: "d-a", timestamp: at(3), type: "annotation", target: "d-a:1", body: "from my laptop", access: "public" });
    assert.equal(idView([...shelf, note], "d-x").threads["d-a:1"].find(n => n.op.id === "d-a:51")?.mine, true);
});

test("an account's other device may change what the uploader may change", () => {
    const keep = op({ id: "d-x:2", user: "d-x", timestamp: at(4), type: "describe", target: "d-a:1", field: "editors", value: "owner" });
    assert.equal(idView([...shelf, keep], "d-c").documents["d-a:1"].properties.editors, "owner");
    // without the link it's just another device, and ignored
    assert.equal(view([...shelf, keep]).documents["d-a:1"].properties.editors, undefined);
});

test("a steward account counts on every one of its devices", () => {
    const hide = op({ id: "d-x:3", user: "d-x", timestamp: at(5), type: "hide", target: "d-b:1" });
    assert.equal(idView([...shelf, hide], "d-c", ["a-ama"]).threads["d-a:1"].length, 1);
    assert.equal(idView([...shelf, hide], "d-c", []).threads["d-a:1"].length, 2);
});

test("a collection is for everyone to see and only its owner to fill, until the owner says otherwise", () => {
    const ops = [...shelf, named("d-a:60", "d-a", "a-ama/1", "Shelf", 1), add("d-b:60", "d-b", "a-ama/1", "d-a:1", 2)];
    const c = idView(ops, "d-c").collections["a-ama/1"];
    assert.deepEqual(c.documentIds, []);                    // Rosa wasn't asked
    assert.equal(c.mayAdd, false);
    assert.equal(c.see.kind, "everyone");
});

test("people and groups the owner names may add; an add from before they were asked doesn't count", () => {
    const ops = [...shelf,
        named("d-a:60", "d-a", "a-ama/1", "Shelf", 1),
        add("d-b:60", "d-b", "a-ama/1", "s:1", 2),       // too early
        access("d-a:61", "d-a", "a-ama/1", "everyone", "people:g-club", 3),
        add("d-b:61", "d-b", "a-ama/1", "d-a:1", 4),
        add("d-c:60", "d-c", "a-ama/1", "s:2", 5)];      // a guest isn't in the group
    const v = idView(ops, "d-b");
    assert.deepEqual(v.collections["a-ama/1"].documentIds, ["d-a:1"]);
    assert.equal(v.collections["a-ama/1"].mayAdd, true);
    assert.equal(idView(ops, "d-c").collections["a-ama/1"].mayAdd, false);
});

test("whoever added a document may take it out; the owner may take out anything; others can't", () => {
    const base = [...shelf,
        access("d-a:61", "d-a", "a-ama/1", "everyone", "everyone", 1),
        add("d-b:61", "d-b", "a-ama/1", "d-a:1", 2),
        add("d-c:61", "d-c", "a-ama/1", "s:1", 3)];
    assert.deepEqual(idView([...base, remove("d-c:62", "d-c", "a-ama/1", "d-a:1", 4)], "d-a").collections["a-ama/1"].documentIds, ["d-a:1", "s:1"]);
    assert.deepEqual(idView([...base, remove("d-b:62", "d-b", "a-ama/1", "d-a:1", 4)], "d-a").collections["a-ama/1"].documentIds, ["s:1"]);
    assert.deepEqual(idView([...base, remove("d-x:62", "d-x", "a-ama/1", "s:1", 4)], "d-a").collections["a-ama/1"].documentIds, ["d-a:1"]);
});

test("a private collection is there for its owner only, and not in anyone else's feed", () => {
    const ops = [...shelf, named("d-a:60", "d-a", "a-ama/1", "Diary", 1), access("d-a:61", "d-a", "a-ama/1", "owner", "owner", 2), add("d-a:62", "d-a", "a-ama/1", "d-a:1", 3)];
    assert.equal(idView(ops, "d-x").collections["a-ama/1"].name, "Diary");
    assert.equal(idView(ops, "d-b").collections["a-ama/1"], undefined);
    assert.equal(idView(ops, "d-b").collectionOrder.includes("a-ama/1"), false);
    assert.equal(idView(ops, "d-b").feed.some(e => (e.kind === "collect" || e.kind === "collection") && e.op.collectionId === "a-ama/1"), false);
    assert.equal(idView(ops, "d-b").collectionsByDocument["d-a:1"]?.includes("a-ama/1") ?? false, false);
});

test("shared with people and groups: they see it, no one else does", () => {
    const ops = [...shelf, named("d-a:60", "d-a", "a-ama/1", "For the club", 1), access("d-a:61", "d-a", "a-ama/1", "people:g-club", "owner", 2)];
    assert.ok(idView(ops, "d-b").collections["a-ama/1"]);
    assert.equal(idView(ops, "d-c").collections["a-ama/1"], undefined);
});

test("only the owner sets who may see; a malformed setting is ignored", () => {
    const ops = [...shelf, named("d-a:60", "d-a", "a-ama/1", "Shelf", 1),
        access("d-b:61", "d-b", "a-ama/1", "owner", "everyone", 2),
        access("d-a:62", "d-a", "a-ama/1", "friends", "owner", 3)];
    const c = idView(ops, "d-c").collections["a-ama/1"];
    assert.equal(c.see.kind, "everyone");
    assert.equal(c.add.kind, "owner");
});

test("without an account a guest is their own person, as before", () => {
    const v = view([...shelf, add("d-b:70", "d-b", "d-b/kept", "s:1", 1)], "d-b");
    assert.equal(v.collections["d-b/kept"].mine, true);
    assert.deepEqual(v.collections["d-b/kept"].documentIds, ["d-a:1", "s:1"]);
});
