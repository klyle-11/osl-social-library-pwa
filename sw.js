// Service worker: the doorkeeper that makes OSL open with no signal.
// Only runs in a secure context (HTTPS, or http://localhost while developing).
//
// - App shell: precached on install; served cache-first and refreshed in the
//   background (stale-while-revalidate), so the app opens instantly offline
//   and picks up new versions the next time it's opened online.
// - Media (./media/<sha256>): content addressed, so a cached copy never goes
//   stale. Cache-first, network fallback.
// - ./sync, ./status and every non-GET request: straight to the network, never cached.

const SHELL_CACHE = "osl-shell-v1"; // bump to force a clean re-cache of the shell
const MEDIA_CACHE = "osl-media"; // shared with src/db.js; kept across versions
const SHELL = [
    "./",
    "./index.html",
    "./styles.css",
    "./dist/app.js",
    "./manifest.webmanifest",
    "./icons/icon-192.png",
    "./icons/icon-512.png",
    "./icons/icon-maskable-512.png",
    "./icons/apple-touch-icon.png",
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches
            .open(SHELL_CACHE)
            .then((cache) => cache.addAll(SHELL.map((u) => new Request(u, { cache: "reload" }))))
            .then(() => self.skipWaiting()),
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches
            .keys()
            .then((keys) => Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== MEDIA_CACHE).map((k) => caches.delete(k))))
            .then(() => self.clients.claim()),
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);
    if (url.origin !== location.origin) return;

    const scope = new URL(self.registration.scope);
    const path = url.pathname.slice(scope.pathname.length);

    if (path === "sync" || path === "status") return;

    if (path.startsWith("media/")) {
        event.respondWith(
            caches.open(MEDIA_CACHE).then(async (cache) => (await cache.match(req, { ignoreSearch: true })) || fetch(req)),
        );
        return;
    }

    // Navigations (any page URL) get the app's index.html.
    const key = req.mode === "navigate" ? "./index.html" : req;
    event.respondWith(staleWhileRevalidate(event, key, req));
});

async function staleWhileRevalidate(event, key, req) {
    const cache = await caches.open(SHELL_CACHE);
    const cached = await cache.match(key, { ignoreSearch: true });
    const network = fetch(req)
        .then((res) => {
            if (res.ok && res.type === "basic") cache.put(key, res.clone());
            return res;
        })
        .catch(() => null);
    if (cached) {
        event.waitUntil(network);
        return cached;
    }
    return (await network) || new Response("Offline and not cached yet.", { status: 503, headers: { "Content-Type": "text/plain" } });
}
