// On-device storage: IndexedDB holds the op log, the outbox and device meta.
// Media files live in Cache Storage under ./media/<hash> so the service
// worker can serve them offline like any other URL.

const DB_NAME = "osl";
const DB_VERSION = 1;
export const MEDIA_CACHE = "osl-media";

let dbPromise;

export function openDb() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = () => {
                const db = req.result;
                db.createObjectStore("ops", { keyPath: "id" });
                db.createObjectStore("outbox", { keyPath: "id" });
                db.createObjectStore("meta");
            };
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error);
        });
    }
    return dbPromise;
}

function done(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        // Only an abort fails the transaction; request errors we handled bubble here too.
        tx.onabort = () => reject(tx.error || new Error("transaction aborted"));
    });
}

function result(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export async function getMeta(key) {
    const db = await openDb();
    return result(db.transaction("meta").objectStore("meta").get(key));
}

export async function setMeta(key, value) {
    const db = await openDb();
    const tx = db.transaction("meta", "readwrite");
    tx.objectStore("meta").put(value, key);
    return done(tx);
}

function randomId() {
    if (crypto.randomUUID) return crypto.randomUUID().slice(0, 8);
    return [...crypto.getRandomValues(new Uint8Array(4))].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function getDeviceId() {
    let id = await getMeta("deviceId");
    if (!id) {
        id = "phone-" + randomId();
        await setMeta("deviceId", id);
    }
    return id;
}

/**
 * Create a new op from this device. In ONE transaction: bump the counter,
 * write the op to the log, and put its id in the outbox. All or nothing.
 */
export async function addLocalOp(fields) {
    const author = await getDeviceId();
    const db = await openDb();
    const tx = db.transaction(["ops", "outbox", "meta"], "readwrite");
    const meta = tx.objectStore("meta");
    const counter = ((await result(meta.get("counter"))) || 0) + 1;
    const op = { ...fields, id: `${author}:${counter}`, author, created: new Date().toISOString() };
    meta.put(counter, "counter");
    tx.objectStore("ops").put(op);
    tx.objectStore("outbox").put({ id: op.id });
    await done(tx);
    return op;
}

/**
 * Store ops that came from elsewhere (sync, bundle). Existing ids are left alone.
 * With relay=true they also go in the outbox, so ops carried in by hand
 * reach the node too (the node ignores ids it already has).
 */
export async function putRemoteOps(ops, relay = false) {
    const db = await openDb();
    const tx = db.transaction(["ops", "outbox"], "readwrite");
    const store = tx.objectStore("ops");
    for (const op of ops) {
        store.add(op).onerror = (e) => {
            e.preventDefault(); // duplicate id: keep ours, don't abort the transaction
            e.stopPropagation();
        };
        if (relay) tx.objectStore("outbox").put({ id: op.id });
    }
    return done(tx);
}

export async function allOps() {
    const db = await openDb();
    return result(db.transaction("ops").objectStore("ops").getAll());
}

export async function outboxOps() {
    const db = await openDb();
    const tx = db.transaction(["outbox", "ops"]);
    const ids = await result(tx.objectStore("outbox").getAllKeys());
    const ops = await Promise.all(ids.map((id) => result(tx.objectStore("ops").get(id))));
    return ops.filter(Boolean);
}

export async function clearOutbox(ids) {
    const db = await openDb();
    const tx = db.transaction("outbox", "readwrite");
    for (const id of ids) tx.objectStore("outbox").delete(id);
    return done(tx);
}

// ---- media (content addressed) ----

export function mediaUrl(hash) {
    return new URL("media/" + hash, document.baseURI).href;
}

export async function hashBlob(blob) {
    const buf = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
    return "sha256-" + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function putMedia(hash, blob, type) {
    const cache = await caches.open(MEDIA_CACHE);
    await cache.put(mediaUrl(hash), new Response(blob, { headers: { "Content-Type": type || blob.type || "application/octet-stream" } }));
}

export async function getMedia(hash) {
    const cache = await caches.open(MEDIA_CACHE);
    const res = await cache.match(mediaUrl(hash));
    return res ? res.blob() : null;
}

export async function hasMedia(hash) {
    const cache = await caches.open(MEDIA_CACHE);
    return !!(await cache.match(mediaUrl(hash)));
}

/** Ask the browser not to evict our data under storage pressure. */
export async function requestPersistence() {
    if (!navigator.storage || !navigator.storage.persist) return false;
    if (await navigator.storage.persisted()) return true;
    return navigator.storage.persist();
}
