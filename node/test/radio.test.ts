import { test } from "node:test";
import assert from "node:assert/strict";
import { createBridge, type RadioLibrary } from "../radio";
import { validateOp } from "../../core/ops";
import type { Op } from "../../core/types";

const T = "2026-10-04T12:00:00Z";
const note = (id: string, body = "hi"): Op =>
    ({ id, type: "annotation", user: id.slice(0, id.lastIndexOf(":")), timestamp: T, target: "steward:1", body, access: "public" });

// a library the drop points carry, with a log that takes what's valid
function library(id: string, log: Op[] = [], hash: string | null = null): RadioLibrary {
    return {
        id, name: id === "main" ? "Library" : id, hash, log, logId: id === "main" ? "lib" : `${id}-log`,
        accept(ops) {
            const rejected: string[] = [];
            let added = 0;
            for (const o of ops) {
                const v = validateOp(o);
                if (!v.ok) rejected.push(v.reason);
                else if (!log.some(x => x.id === v.op.id)) { log.push(v.op); added++; }
            }
            return { added, rejected };
        }
    };
}

// a node with a log (or several), and a modem that records what it was told
function rig(log: Op[] = [], saved: string | null = null, others: RadioLibrary[] = []) {
    const lines: Record<string, unknown>[] = [];
    let position = saved;
    let clock = 0;
    const libs = [library("main", log), ...others];
    const bridge = createBridge({
        libraries: () => libs,
        loadPosition: () => position,
        savePosition: p => { position = p; },
        write: l => lines.push(JSON.parse(l)),
        now: () => clock,
        say: () => {}
    });
    // what was sent, leaving out the list of libraries
    const sends = () => lines.filter(l => l.t === "send");
    // how far the main library's return path has gone
    const at = () => (position?.startsWith("{") ? JSON.parse(position).main : position) as string | null;
    return { bridge, lines, sends, log, libs, position: at, raw: () => position, tick: (ms: number) => { clock += ms; } };
}

test("an op from a drop point is stored, then the modem hears durable", () => {
    const r = rig();
    r.bridge.onLine(JSON.stringify({ t: "recv", m: 7, op: note("phone-a:1") }));
    assert.equal(r.log.length, 1);
    assert.deepEqual(r.lines, [{ t: "durable", m: 7 }]);
    // the drop point didn't hear "durable" and sends it again: stored once, durable again
    r.bridge.onLine(JSON.stringify({ t: "recv", m: 7, op: note("phone-a:1") }));
    assert.equal(r.log.length, 1);
    assert.equal(r.lines.length, 2);
    assert.equal(r.bridge.status().receivedFromDropPoint, 1);
});

test("an invalid op is refused but still durable, so it isn't sent forever", () => {
    const r = rig();
    r.bridge.onLine(JSON.stringify({ t: "recv", m: 9, op: { id: "x" } }));
    assert.equal(r.log.length, 0);
    assert.deepEqual(r.lines, [{ t: "durable", m: 9 }]);
});

test("the return path sends the log one op at a time, in order, and remembers how far", () => {
    const r = rig([note("a:1"), note("b:1")]);
    r.bridge.pump();
    r.bridge.pump();   // still in flight: nothing more
    assert.deepEqual(r.sends().map(l => l.id), ["a:1"]);
    r.bridge.onLine(JSON.stringify({ t: "sent", id: "a:1" }));
    assert.deepEqual(r.sends().map(l => l.id), ["a:1", "b:1"]);
    assert.equal(r.position(), "lib.1");
    r.bridge.onLine(JSON.stringify({ t: "sent", id: "b:1" }));
    assert.equal(r.position(), "lib.2");
    assert.equal(r.bridge.status().waitingToSend, 0);
});

test("a silent modem is offered the op again after a while", () => {
    const r = rig([note("a:1")]);
    r.bridge.pump();
    r.tick(60_000); r.bridge.pump();
    assert.equal(r.sends().length, 1);
    r.tick(61_000); r.bridge.pump();
    assert.equal(r.sends().length, 2);
    assert.equal(r.sends()[1].id, "a:1");
});

test("hidden ops never go out; the hide does", () => {
    const hide: Op = { id: "s:2", type: "hide", user: "s", timestamp: T, target: "a:1" };
    const r = rig([note("a:1"), hide]);
    r.bridge.pump();
    assert.deepEqual(r.sends().map(l => l.id), ["s:2"]);
});

test("a saved position from another log (a clean start) starts again from the beginning", () => {
    const r = rig([note("a:1")], "old-log.40");
    r.bridge.pump();
    assert.deepEqual(r.sends().map(l => l.id), ["a:1"]);
    const same = rig([note("a:1"), note("a:2")], "lib.1");   // as saved before there were several libraries
    same.bridge.pump();
    assert.deepEqual(same.sends().map(l => l.id), ["a:2"]);
});

test("boot noise and odd lines are ignored", () => {
    const r = rig();
    for (const l of ["", "ESP-ROM:esp32s3", "null", "[1,2]", '{"t":"what"}']) r.bridge.onLine(l);
    r.bridge.onLine(JSON.stringify({ t: "hello", radio: true, rssi: -40 }));
    assert.equal(r.lines.length, 0);
    assert.equal(r.bridge.status().modem?.radio, true);
});

// ---- several libraries (W-D12) ----

test("drop points get the list of libraries first, with password hashes, and again when it changes", () => {
    const poetry = library("poetry", [], "pbkdf2-sha256$1000$c2FsdA$aGFzaA");
    const r = rig([], null, [poetry]);
    r.bridge.pump();
    assert.deepEqual(r.lines[0], { t: "libs", libs: [{ id: "main", name: "Library", hash: "" }, { id: "poetry", name: "poetry", hash: poetry.hash }] });
    r.bridge.pump();
    assert.equal(r.lines.filter(l => l.t === "libs").length, 1);   // nothing changed
    poetry.name = "Poetry club";
    r.bridge.pump();
    assert.equal(r.lines.filter(l => l.t === "libs").length, 2);
    r.tick(601_000);
    r.bridge.pump();
    assert.equal(r.lines.filter(l => l.t === "libs").length, 3);   // and now and then, for a drop point that missed it
});

test("libraries take turns on the air; another library's ops say which it is", () => {
    const poetry = library("poetry", [note("p:1"), note("p:2")]);
    const r = rig([note("a:1"), note("a:2")], null, [poetry]);
    const order: string[] = [];
    for (let i = 0; i < 4; i++) {
        r.bridge.pump();
        const last = r.sends().at(-1)!;
        order.push(`${String(last.l ?? "main")} ${String(last.id)}`);
        r.bridge.onLine(JSON.stringify({ t: "sent", id: last.id }));
    }
    assert.deepEqual(order, ["main a:1", "poetry p:1", "main a:2", "poetry p:2"]);
    assert.deepEqual(JSON.parse(r.raw()!), { main: "lib.2", poetry: "poetry-log.2" });
    assert.equal(r.bridge.status().waitingToSend, 0);
});

test("an op from a drop point goes into the library it names; one not carried is refused, still durable", () => {
    const poetry = library("poetry");
    const r = rig([], null, [poetry]);
    r.bridge.onLine(JSON.stringify({ t: "recv", m: 3, l: "poetry", op: note("phone:1") }));
    r.bridge.onLine(JSON.stringify({ t: "recv", m: 4, l: "secret", op: note("phone:2") }));
    assert.deepEqual(poetry.log.map(o => o.id), ["phone:1"]);
    assert.equal(r.log.length, 0);
    assert.deepEqual(r.lines, [{ t: "durable", m: 3 }, { t: "durable", m: 4 }]);
});

test("a library's ops that aren't for everyone never go out", () => {
    const poetry = library("poetry", [note("p:1"), note("p:2")]);
    poetry.skip = op => op.id === "p:1";
    const r = rig([], null, [poetry]);
    r.bridge.pump();
    assert.deepEqual(r.sends().map(l => l.id), ["p:2"]);
});
