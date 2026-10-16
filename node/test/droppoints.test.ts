import { test } from "node:test";
import assert from "node:assert/strict";
import { DropPointRegister } from "../droppoints";
import { createBridge } from "../radio";

const T0 = new Date("2026-10-16T12:00:00Z");
const later = (s: number) => new Date(T0.getTime() + s * 1000);
const beat = (over: Record<string, unknown> = {}) => ({
    rssi: -97.5, snr: 6.2,
    status: { id: "drop-a1b2c3", name: "Community garden", app: "a4092bd8ec7f", every: 120, up: 3600, waiting: 3, ops: 40, flashFree: 812000, phones: 2, rssi: -95, snr: 7, ...over }
});

test("a heartbeat lists the drop point as connected, with both directions' signal", () => {
    const r = new DropPointRegister(null, () => {});
    assert.ok(r.heard(beat(), T0));
    const [p] = r.list(later(60), "a4092bd8ec7f");
    assert.equal(p.name, "Community garden");
    assert.equal(p.state, "connected");
    assert.deepEqual(p.atLibrary, { rssi: -97.5, snr: 6.2 });
    assert.deepEqual(p.atDropPoint, { rssi: -95, snr: 7 });
    assert.equal(p.waiting, 3);
    assert.equal(p.sameApp, true);
});

test("silent for a few of its own intervals: not heard since, but still listed", () => {
    const r = new DropPointRegister(null, () => {});
    r.heard(beat(), T0);
    assert.equal(r.list(later(299), "")[0].state, "connected");   // one lost heartbeat is normal
    assert.equal(r.list(later(301), "")[0].state, "not-heard");
    r.heard(beat(), later(400));
    assert.equal(r.list(later(401), "")[0].state, "connected");
    assert.equal(r.list(later(401), "")[0].firstSeen, T0.toISOString());
});

test("an older app on the drop point is flagged; an unknown one isn't", () => {
    const r = new DropPointRegister(null, () => {});
    r.heard(beat({ app: "0000aaaa" }), T0);
    assert.equal(r.list(T0, "a4092bd8ec7f")[0].sameApp, false);
    assert.equal(r.list(T0, "")[0].sameApp, null);
});

test("what crosses an open radio channel is checked and bounded", () => {
    const r = new DropPointRegister(null, () => {});
    assert.equal(r.heard({ status: null }, T0), false);
    assert.equal(r.heard({ status: { id: "../../etc" } }, T0), false);
    assert.ok(r.heard({ rssi: "loud", status: { id: "drop-x", name: "a\u0000b".padEnd(500, "c"), waiting: -5, every: 1e12, app: "<script>" } }, T0));
    const [p] = r.list(T0, "");
    assert.equal(p.name.length, 60);
    assert.ok(!p.name.includes("\u0000"));
    assert.equal(p.waiting, 0);
    assert.equal(p.every, 120);
    assert.equal(p.app, "");
    assert.equal(p.atLibrary, null);
    for (let i = 0; i < 100; i++) r.heard(beat({ id: `drop-${i}` }), T0);
    assert.equal(r.list(T0, "").length, 64);
});

test("the list survives a restart, and forgetting takes one off", () => {
    let saved = "";
    const r = new DropPointRegister(null, j => { saved = j; });
    r.heard(beat(), T0);
    r.heard(beat({ id: "drop-other", name: "Annex" }), T0);
    const again = new DropPointRegister(saved, j => { saved = j; });
    assert.equal(again.list(T0, "").length, 2);
    assert.ok(again.forget("drop-other"));
    assert.deepEqual(new DropPointRegister(saved, () => {}).list(T0, "").map(p => p.id), ["drop-a1b2c3"]);
    assert.equal(new DropPointRegister("not json", () => {}).list(T0, "").length, 0);
});

test("the bridge hands the modem's status lines to the register, and nothing goes back", () => {
    const r = new DropPointRegister(null, () => {});
    const lines: string[] = [];
    const bridge = createBridge({
        libraries: () => [{ id: "main", name: "Library", hash: null, log: [], logId: "lib", accept: () => ({ added: 0, rejected: [] }) }],
        loadPosition: () => null, savePosition: () => {}, write: l => lines.push(l),
        onStatus: line => { r.heard(line, T0); }, say: () => {}
    });
    bridge.onLine(JSON.stringify({ t: "status", ...beat() }));
    assert.equal(r.list(T0, "")[0].id, "drop-a1b2c3");
    assert.equal(lines.length, 0);   // the modem marks a heartbeat durable itself (and nothing pumped, so no list either)
});
