// "What you collect is what you carry": files for documents in someone's
// collections are copied into the Cache API, where the service worker finds
// them offline. Only exists in a secure context (https or localhost).
const CACHE = "osl-carry-v1";

// files bigger than this stay at the library and play only while connected
export const CARRY_LIMIT = 40 * 1024 * 1024;

export function canCarry(): boolean {
    return typeof caches !== "undefined";
}

export async function carried(url: string): Promise<boolean> {
    if (!canCarry()) return false;
    const cache = await caches.open(CACHE);
    return !!(await cache.match(url));
}

// returns the urls that failed (offline, or missing on the node)
export async function carry(urls: string[]): Promise<string[]> {
    if (!canCarry()) return urls;
    const cache = await caches.open(CACHE);
    const failed: string[] = [];
    for (const url of urls) {
        if (await cache.match(url)) continue;
        try {
            // ask the size first: a film in someone's collection shouldn't fill their phone unasked
            const head = await fetch(url, { method: "HEAD" });
            if (Number(head.headers.get("content-length") ?? 0) > CARRY_LIMIT) { failed.push(url); continue; }
            const res = await fetch(url);
            if (!res.ok) throw new Error(String(res.status));
            await cache.put(url, res);
        } catch {
            failed.push(url);
        }
    }
    return failed;
}

// ask the browser not to evict our storage (installed PWAs usually get this)
export async function persistStorage(): Promise<boolean> {
    try {
        return (await navigator.storage?.persist?.()) ?? false;
    } catch {
        return false;
    }
}
