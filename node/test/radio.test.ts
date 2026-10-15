import { test } from "node:test";
import assert from "node:assert/strict";
import { createBridge } from "../radio";
import { validateOp } from "../../core/ops";
import type { Op } from "../../core/types";

const T = "2026-10-04T12:00:00Z";
const note = (id: string, body = "hi"): Op =>
    ({ id, type: "annotation", user: id.slice(0, id.lastIndexOf(":")), timestamp: T, target: "steward:1", body, access: "public" });

// a node with a log, and a modem that records what it was told
function rig(log: Op[] = [], saved: string | null = null) {
    const lines: Record<string, unknown>[] = [];
    let position = saved;
    let clock = 0;
    const bridge = createBridge({
        log, logId: "lib",
        accept(ops) {
            const rejected: string[] = [];
            let added = 0;
            for (const o of ops) {
                const v = validateOp(o);
                if (!v.ok) rejected.push(v.reason);
                else if (!log.some(x => x.id === v.op.id)) { log.push(v.op); added++; }
            }
            return { added, rejected };
        },
        loadPosition: () => position,
        savePosition: p => { position = p; },
        write: l => lines.push(JSON.parse(l)),
        now: () => clock,
        say: () => {}
    });
    return { bridge, lines, log, position: () => position, tick: (ms: number) => { clock += ms; } };
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
    assert.deepEqual(r.lines.map(l => l.id), ["a:1"]);
    r.bridge.onLine(JSON.stringify({ t: "sent", id: "a:1" }));
    assert.deepEqual(r.lines.map(l => l.id), ["a:1", "b:1"]);
    assert.equal(r.position(), "lib.1");
    r.bridge.onLine(JSON.stringify({ t: "sent", id: "b:1" }));
    assert.equal(r.position(), "lib.2");
    assert.equal(r.bridge.status().waitingToSend, 0);
});

test("a silent modem is offered the op again after a while", () => {
    const r = rig([note("a:1")]);
    r.bridge.pump();
    r.tick(60_000); r.bridge.pump();
    assert.equal(r.lines.length, 1);
    r.tick(61_000); r.bridge.pump();
    assert.equal(r.lines.length, 2);
    assert.equal(r.lines[1].id, "a:1");
});

test("hidden ops never go out; the hide does", () => {
    const hide: Op = { id: "s:2", type: "hide", user: "s", timestamp: T, target: "a:1" };
    const r = rig([note("a:1"), hide]);
    r.bridge.pump();
    assert.deepEqual(r.lines.map(l => l.id), ["s:2"]);
});

test("a saved position from another log (a clean start) starts again from the beginning", () => {
    const r = rig([note("a:1")], "old-log.40");
    r.bridge.pump();
    assert.deepEqual(r.lines.map(l => l.id), ["a:1"]);
    const same = rig([note("a:1"), note("a:2")], "lib.1");
    same.bridge.pump();
    assert.deepEqual(same.lines.map(l => l.id), ["a:2"]);
});

test("boot noise and odd lines are ignored", () => {
    const r = rig();
    for (const l of ["", "ESP-ROM:esp32s3", "null", "[1,2]", '{"t":"what"}']) r.bridge.onLine(l);
    r.bridge.onLine(JSON.stringify({ t: "hello", radio: true, rssi: -40 }));
    assert.equal(r.lines.length, 0);
    assert.equal(r.bridge.status().modem?.radio, true);
});
