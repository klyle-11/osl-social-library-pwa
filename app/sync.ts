import { effect } from "@preact/signals";
import type { LibraryStore } from "../core/store";
import type { HttpTransport } from "../adapters/http-transport";
import { carry } from "../adapters/carry";
import { fileUrl } from "./format";
import { href, route } from "./route";
import { follow, lastSync, paused, pending, presence, syncState, views, viewer } from "./state";

// How often an open, visible app asks the node what's new. Short enough that a
// note appears on the big screen while people are still looking at it.
const TICK_MS = 2000;
const SLOWEST_MS = 15_000;

let wake: () => void = () => {};

// "Sync now" on the sync screen
export function syncNow() {
    wake();
}

// Keeps this device and the node in step: on open, after each change, when the
// connection comes back, when the app comes to the front, and every tick while open.
// Each tick is one request that sends what's waiting, fetches what's new, and says hello.
export async function startSync(store: LibraryStore, transport: HttpTransport) {
    transport.onPresence = p => { presence.value = p; };

    if (!(await transport.available())) {
        syncState.value = navigator.onLine ? "no-node" : "offline";
    }

    let timer: ReturnType<typeof setTimeout> | undefined;
    let failures = 0;
    const run = async () => {
        clearTimeout(timer);
        // a hidden tab stops polling; the node forgets it within a few seconds, which is the truth
        if (document.visibilityState !== "visible") return;
        if (paused.value) { syncState.value = "paused"; return; }

        const r = route.value;
        transport.hello = { user: store.user, viewing: r.view === "document" ? r.id : "" };
        // only say "Syncing…" when recovering, so the header doesn't flicker every tick
        if (syncState.value !== "synced") syncState.value = "syncing";
        try {
            await store.sync(transport);
            syncState.value = "synced";
            lastSync.value = new Date().toISOString();
            failures = 0;
        } catch {
            syncState.value = navigator.onLine ? "no-node" : "offline";
            presence.value = { online: [], showing: null };
            failures++;
        }
        pending.value = store.outbox.length;
        // back off while the node is unreachable, so a phone that left isn't hammering the air
        timer = setTimeout(run, Math.min(TICK_MS * 2 ** failures, SLOWEST_MS));
    };
    const soon = () => { clearTimeout(timer); timer = setTimeout(run, 300); };
    wake = soon;

    store.subscribe(() => {
        pending.value = store.outbox.length;
        if (store.outbox.length || store.mediaOutbox.length) soon();
    });
    addEventListener("online", soon);
    addEventListener("hashchange", soon);       // so "is viewing this" updates promptly
    document.addEventListener("visibilitychange", soon);
    effect(() => { paused.value; soon(); });

    // following: when the big screen moves to another document, so does this device
    let followed = "";
    effect(() => {
        const showing = presence.value.showing;
        if (!follow.value || !showing || showing.documentId === followed) return;
        followed = showing.documentId;
        if (route.peek().view !== "present") location.hash = href({ view: "document", id: showing.documentId });
    });

    await run();
}

// What you collect is what you carry: whenever this person's collections
// change, copy those documents' files onto the phone.
export function startCarrying() {
    let last = "";
    effect(() => {
        const v = views.value;
        const me = viewer.value;
        const urls = new Set<string>();
        for (const c of Object.values(v.collections)) {
            if (c.owner !== me) continue;
            for (const id of c.documentIds) {
                const doc = v.documents[id];
                const url = doc && fileUrl(doc);
                if (url) urls.add(url);
            }
        }
        const key = [...urls].sort().join("\n");
        if (key === last) return;
        last = key;
        void carry([...urls]);
    });
}
