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

const BATCH = 10; // ops per request: small enough for a drop point board's memory

/**
 * Files are uploaded separately from ops. A drop point refuses them (it has no
 * room), so hashes stay on a pending list until a node with storage accepts them.
 */
async function uploadMedia(ops) {
    const pending = new Set((await getMeta("pendingMedia")) || []);
    for (const h of mediaHashes(ops)) pending.add(h);
    for (const hash of [...pending]) {
        const blob = await getMedia(hash);
        if (!blob) {
            pending.delete(hash);
            continue;
        }
        try {
            const res = await fetch(new URL("media/" + hash, document.baseURI), {
                method: "PUT",
                body: blob,
                headers: { "Content-Type": blob.type || "application/octet-stream" },
            });
            if (res.ok) pending.delete(hash);
        } catch {
            break; // offline: try again next sync
        }
    }
    await setMeta("pendingMedia", [...pending]);
    return pending.size;
}

async function post(ops, cursors) {
    const res = await fetch(SYNC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ops, cursors }),
        cache: "no-store",
    });
    if ([404, 405, 501].includes(res.status)) throw Object.assign(new Error("no node"), { noNode: true });
    if (!res.ok) throw new Error(`sync ${res.status}`);
    return res.json();
}

async function doSync() {
    const pending = await outboxOps();
    const mediaWaiting = await uploadMedia(pending);
    // One cursor per node: the archive and each drop point number their ops separately.
    const cursors = (await getMeta("cursors")) || {};
    // Ops a drop point accepted but the archive hasn't confirmed yet. Ops only ever
    // come back to phones from the archive, so seeing one again means it arrived there.
    const atDropPoint = new Set((await getMeta("atDropPoint")) || []);
    let sent = 0,
        received = 0,
        node = null,
        i = 0;
    do {
        const batch = pending.slice(i, i + BATCH);
        i += BATCH;
        /** @type {{node: string, acked: string[], ops: any[], cursor: number}} */
        const reply = await post(batch, cursors);
        const incoming = reply.ops.filter((op) => !validateOp(op));
        await putRemoteOps(incoming);
        await clearOutbox(reply.acked);
        node = reply.node || "archive";
        for (const op of incoming) atDropPoint.delete(op.id);
        if (node.startsWith("drop-")) for (const id of reply.acked) atDropPoint.add(id);
        cursors[node] = reply.cursor;
        await setMeta("cursors", cursors);
        sent += reply.acked.length;
        received += incoming.length;
    } while (i < pending.length);
    await setMeta("atDropPoint", [...atDropPoint]);
    await setMeta("lastSync", new Date().toISOString());
    await setMeta("lastNode", node);
    return { sent, received, node, mediaWaiting };
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
