// The Pi side of the radio link, without hardware: a fake modem talks to the bridge.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createBridge } from "../radio-bridge.js";
import { validateOp } from "../src/contract.js";

const op = (id, extra = {}) => ({ id, type: "comment", author: id.split(":")[0], created: "2026-10-04T14:22:05Z", target: "seed:1", body: "hi", access: "public", ...extra });

function setup() {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "osl-radio-"));
    const log = [];
    const appendOps = async (ops) => {
        for (const o of ops) if (!log.some((e) => e.op.id === o.id)) log.push({ seq: log.length + 1, op: o });
    };
    const lines = [];
    let clock = 0;
    const make = () => createBridge({ log, appendOps, validateOp, dataDir, write: (l) => lines.push(JSON.parse(l)), now: () => clock, say: () => {} });
    return { log, lines, make, tick: (ms) => (clock += ms), dataDir };
}

test("ops from the drop point are stored before the modem hears 'durable'", async () => {
    const { log, lines, make } = setup();
    const b = make();
    await b.onLine(JSON.stringify({ t: "recv", m: 77, op: op("P:1") }));
    assert.equal(log.length, 1);
    assert.deepEqual(lines.at(-1), { t: "durable", m: 77 });
    await b.onLine(JSON.stringify({ t: "recv", m: 78, op: op("P:1") })); // durable got lost, sent again
    assert.equal(log.length, 1);
    assert.deepEqual(lines.at(-1), { t: "durable", m: 78 });
    await b.onLine(JSON.stringify({ t: "recv", m: 79, op: { id: "junk" } })); // invalid: dropped, but acked so it stops
    assert.equal(log.length, 1);
    assert.deepEqual(lines.at(-1), { t: "durable", m: 79 });
    await b.onLine("garbage from a rebooting board");
    assert.equal(b.status().receivedFromDropPoint, 1);
});

test("return path: in order, one at a time, hidden ops skipped, resumes after restart", async () => {
    const { log, lines, make, tick } = setup();
    log.push({ seq: 1, op: op("A:1") }, { seq: 2, op: op("A:2") }, { seq: 3, op: op("M:1", { type: "hide", target: "A:2" }) }, { seq: 4, op: op("A:3") });
    let b = make();
    b.pump();
    assert.equal(lines.at(-1).id, "A:1");
    b.pump(); // still in flight: nothing new
    assert.equal(lines.length, 1);
    tick(130_000); // modem silent too long: offer again
    b.pump();
    assert.equal(lines.length, 2);
    assert.equal(lines.at(-1).id, "A:1");
    await b.onLine(JSON.stringify({ t: "sent", id: "A:1" }));
    assert.equal(lines.at(-1).id, "M:1"); // A:2 is hidden: never leaves the archive
    await b.onLine(JSON.stringify({ t: "sent", id: "M:1" }));
    assert.equal(lines.at(-1).id, "A:3");

    b = make(); // Pi restarts with A:3 unconfirmed
    b.pump();
    assert.equal(lines.at(-1).id, "A:3");
    await b.onLine(JSON.stringify({ t: "sent", id: "A:3" }));
    assert.equal(b.status().waitingToSend, 0);
    assert.equal(b.status().returnPathCursor, 4);
});
