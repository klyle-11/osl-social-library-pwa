// Sync with the node (gate two exchange). Runs while the app is open:
// on launch, when the network comes back, and when the app is brought
// to the foreground. iOS never runs web apps in the background, so the
// outbox just waits until the next time the app is open.

import { outboxOps, clearOutbox, putRemoteOps, getMeta, setMeta, getMedia, putMedia } from "./db.js";
import { mediaHashes, validateOp } from "./contract.js";

const SYNC_URL = new URL("sync", document.baseURI).href;

let running = null;
let queued = null;

/** One sync at a time. A request made mid-sync gets one follow-up run, so new ops aren't missed. */
export function sync() {
    if (!running) {
        running = doSync().finally(() => (running = null));
        return running;
    }
    if (!queued) {
        queued = running.catch(() => {}).then(() => {
            queued = null;
            return sync();
        });
    }
    return queued;
}

async function uploadMedia(ops) {
    for (const hash of mediaHashes(ops)) {
        const blob = await getMedia(hash);
        if (!blob) continue;
        const res = await fetch(new URL("media/" + hash, document.baseURI), {
            method: "PUT",
            body: blob,
            headers: { "Content-Type": blob.type || "application/octet-stream" },
        });
        if (!res.ok) throw new Error(`media upload ${res.status}`);
    }
}

async function doSync() {
    const pending = await outboxOps();
    await uploadMedia(pending);
    const cursor = (await getMeta("cursor")) || 0;
    const res = await fetch(SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops: pending, since: cursor }),
        cache: "no-store",
    });
    if ([404, 405, 501].includes(res.status)) throw Object.assign(new Error("no node"), { noNode: true });
    if (!res.ok) throw new Error(`sync ${res.status}`);
    /** @type {{acked: string[], ops: any[], cursor: number}} */
    const reply = await res.json();
    const incoming = reply.ops.filter((op) => !validateOp(op));
    await putRemoteOps(incoming);
    await clearOutbox(reply.acked);
    await setMeta("cursor", reply.cursor);
    await setMeta("lastSync", new Date().toISOString());
    return { sent: reply.acked.length, received: incoming.length };
}

/** Download media for ops into the offline media cache ("take it with me"). */
export async function fetchMedia(hashes, onProgress) {
    let i = 0;
    for (const hash of hashes) {
        onProgress && onProgress(++i, hashes.length);
        if (await getMedia(hash)) continue;
        const res = await fetch(new URL("media/" + hash, document.baseURI), { cache: "no-store" });
        if (!res.ok) continue;
        await putMedia(hash, await res.blob(), res.headers.get("Content-Type"));
    }
}
