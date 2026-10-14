/// <reference lib="webworker" />
// The service worker: lets the app open with no connection.
// - the app shell is precached on install
// - the shell and catalog.json are network-first (short timeout) so updates and
//   new documents show up when online, and the cached copy is used offline
// - api/ is never cached
// - everything else (including carried documents) is cache-first
declare const OSL_VERSION: string;
const sw = globalThis as unknown as ServiceWorkerGlobalScope;
export {};

const SHELL = `osl-shell-${OSL_VERSION}`;
const SHELL_FILES = [
    "./", "index.html", "app.js", "styles.css", "manifest.webmanifest",
    "icons/icon-192.png", "icons/icon-512.png", "catalog.json"
];

const NETWORK_FIRST = new Set(["index.html", "app.js", "styles.css", "manifest.webmanifest", "catalog.json"]);

sw.addEventListener("install", (event: ExtendableEvent) => {
    event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => sw.skipWaiting()));
});

sw.addEventListener("activate", (event: ExtendableEvent) => {
    event.waitUntil((async () => {
        for (const key of await caches.keys()) {
            if (key.startsWith("osl-shell-") && key !== SHELL) await caches.delete(key);
        }
        await sw.clients.claim();
    })());
});

sw.addEventListener("fetch", (event: FetchEvent) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== sw.location.origin) return;
    const path = url.pathname.slice(new URL(sw.registration.scope).pathname.length);

    if (path.startsWith("api/")) return;

    if (path === "" || NETWORK_FIRST.has(path)) {
        event.respondWith(networkFirst(req));
        return;
    }

    event.respondWith((async () => {
        const hit = await caches.match(req, { ignoreSearch: true });
        if (hit) return req.headers.has("range") ? slice(hit, req.headers.get("range")!) : hit;
        try {
            return await fetch(req);
        } catch (e) {
            if (req.mode === "navigate") {
                const shell = await caches.match("index.html");
                if (shell) return shell;
            }
            throw e;
        }
    })());
});

async function networkFirst(req: Request): Promise<Response> {
    try {
        const res = await withTimeout(fetch(req, { cache: "no-store" }), 2500);
        if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
        return res;
    } catch (e) {
        const hit = await caches.match(req, { ignoreSearch: true })
            ?? (req.mode === "navigate" ? await caches.match("index.html") : undefined);
        if (hit) return hit;
        throw e;
    }
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
    return new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error("timeout")), ms);
        p.then(v => { clearTimeout(t); ok(v); }, e => { clearTimeout(t); fail(e); });
    });
}

// Audio and video elements ask for a file in pieces ("Range" requests), and
// Safari refuses to play unless it gets pieces back. A carried file is cached
// whole, so the piece is cut from it here.
async function slice(whole: Response, range: string): Promise<Response> {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range);
    if (!m || (!m[1] && !m[2])) return whole;
    const blob = await whole.blob();
    const start = m[1] ? Number(m[1]) : Math.max(0, blob.size - Number(m[2]));
    const end = m[1] && m[2] ? Math.min(Number(m[2]), blob.size - 1) : blob.size - 1;
    if (start >= blob.size || start > end) {
        return new Response(null, { status: 416, headers: { "content-range": `bytes */${blob.size}` } });
    }
    return new Response(blob.slice(start, end + 1), {
        status: 206,
        headers: {
            "content-type": whole.headers.get("content-type") ?? "application/octet-stream",
            "content-range": `bytes ${start}-${end}/${blob.size}`,
            "content-length": String(end - start + 1),
            "accept-ranges": "bytes"
        }
    });
}
