// Gate two "done when", automated: acked ops survive a restart, sending the
// same op twice leaves one record, and media must match its hash.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "osl-test-"));
const port = 20000 + Math.floor(Math.random() * 20000);
const base = `http://127.0.0.1:${port}/`;
let proc;

function start() {
    return new Promise((resolve, reject) => {
        proc = spawn(process.execPath, ["server.js"], { cwd: root, env: { ...process.env, PORT: String(port), HOST: "127.0.0.1", DATA_DIR: dataDir } });
        proc.stdout.on("data", (d) => String(d).includes("OSL node on") && resolve());
        proc.on("exit", (code) => reject(new Error("server exited " + code)));
    });
}
function stop() {
    return new Promise((resolve) => {
        proc.removeAllListeners("exit");
        proc.on("exit", resolve);
        proc.kill("SIGKILL"); // like pulling the power
    });
}
after(async () => {
    if (proc && proc.exitCode === null) await stop();
    fs.rmSync(dataDir, { recursive: true, force: true });
});

const comment = (id) => ({ id, type: "comment", author: id.split(":")[0], created: "2026-10-04T14:22:05Z", target: "item-0031", body: "hi", access: "public" });
const sync = async (ops, since = 0) => (await fetch(base + "sync", { method: "POST", body: JSON.stringify({ ops, since }) })).json();

test("sync, idempotency, durability", async () => {
    await start();
    let r = await sync([comment("A:1"), comment("A:2"), { id: "bad" }]);
    assert.deepEqual(r.acked, ["A:1", "A:2"]);
    assert.equal(r.rejected.length, 1);
    assert.equal(r.cursor, 2);

    r = await sync([comment("A:2"), comment("B:1")], 2); // A:2 again (lost reply)
    assert.deepEqual(r.acked, ["A:2", "B:1"]);
    assert.deepEqual(r.ops.map((o) => o.id), ["B:1"]);
    assert.equal(r.cursor, 3);

    await stop();
    await start();
    const s = await (await fetch(base + "status")).json();
    assert.equal(s.ops, 3);
    assert.equal(s.uniqueIds, 3);
    assert.equal(s.devices, 2);
});

test("one cursor per node", async () => {
    const s = await (await fetch(base + "status")).json();
    assert.match(s.node, /^archive-[0-9a-f]{6}$/);
    let r = await (await fetch(base + "sync", { method: "POST", body: JSON.stringify({ ops: [], cursors: { [s.node]: 2, "drop-abc": 9 } }) })).json();
    assert.equal(r.node, s.node);
    assert.deepEqual(r.ops.map((o) => o.id), ["B:1"]);
    r = await (await fetch(base + "sync", { method: "POST", body: JSON.stringify({ ops: [], cursors: { "drop-abc": 9 } }) })).json();
    assert.equal(r.ops.length, 3); // no cursor for this node yet: everything
});

test("media is content addressed", async () => {
    const hash = "sha256-2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"; // "hello"
    let res = await fetch(base + "media/" + hash, { method: "PUT", body: "hello!" });
    assert.equal(res.status, 400);
    res = await fetch(base + "media/" + hash, { method: "PUT", body: "hello", headers: { "Content-Type": "text/plain" } });
    assert.equal(res.status, 201);
    res = await fetch(base + "media/" + hash);
    assert.equal(await res.text(), "hello");
    assert.equal(res.headers.get("content-type"), "text/plain");
});

test("serves the app, not the rest of the repo", async () => {
    assert.equal((await fetch(base)).status, 200);
    assert.equal((await fetch(base + "manifest.webmanifest")).headers.get("content-type"), "application/manifest+json");
    assert.equal((await fetch(base + "some/app/route")).status, 200);
    assert.equal((await fetch(base + "package.json")).status, 404);
    assert.equal((await fetch(base + "server.js")).status, 404);
});

test("seed script is idempotent", async () => {
    execFileSync(process.execPath, ["scripts/seed.js", base], { cwd: root });
    const once = await (await fetch(base + "status")).json();
    execFileSync(process.execPath, ["scripts/seed.js", base], { cwd: root });
    const twice = await (await fetch(base + "status")).json();
    assert.equal(twice.ops, once.ops);
    assert.equal(once.ops, 3 + 7);
    assert.equal(once.media, 1 + 2);
});
