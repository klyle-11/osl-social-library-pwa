import { render } from "preact";
import { LibraryStore, type StorageAdapter } from "../core/store";
import { readCatalog } from "../core/bundle";
import { IndexedDBStorage } from "../adapters/indexeddb-storage";
import { LocalStorageStorage } from "../adapters/local-storage";
import { MemoryStorage } from "../adapters/memory-storage";
import { HttpTransport } from "../adapters/http-transport";
import { newDeviceId, now, recall } from "../adapters/device";
import { persistStorage } from "../adapters/carry";
import { TransportContext, opLog, pending, stewards, tell, tokens, viewer } from "./state";
import { startCarrying, startSync } from "./sync";
import { Library } from "./components/Library";

declare const OSL_DEV: boolean;   // true only in `npm run dev`; the check is removed from production builds

async function loadCatalog() {
    try {
        const res = await fetch("catalog.json");
        return readCatalog(await res.json());
    } catch {
        return readCatalog(null);
    }
}

async function boot() {
    // this shell's adapters, best first. Nothing above this line of code knows which one it got.
    const storage: StorageAdapter = await IndexedDBStorage.open().catch(() =>
        LocalStorageStorage.available() ? new LocalStorageStorage() : new MemoryStorage());
    const store = new LibraryStore(storage, { now, newDeviceId });
    const transport = new HttpTransport();
    tokens.value = {
        ...(recall("token:presenter") && { presenter: recall("token:presenter")! }),
        ...(recall("token:station") && { station: recall("token:station")! })
    };

    const catalog = await loadCatalog();
    stewards.value = catalog.stewards;
    await store.open(catalog.ops);

    viewer.value = store.user;
    opLog.value = store.ops;
    pending.value = store.outbox.length;
    store.subscribe(() => { opLog.value = store.ops; });

    render(
        <TransportContext.Provider value={transport}><Library store={store} /></TransportContext.Provider>,
        document.getElementById("app")!
    );

    if (storage instanceof MemoryStorage) {
        tell("This browser is blocking storage, so anything you add will be lost when you close it.", true);
    }

    if (OSL_DEV) {
        // live reload: the dev node pushes an event after every rebuild. If the node
        // restarts, EventSource reconnects by itself.
        new EventSource("api/dev/reload").onmessage = () => location.reload();
    } else if ("serviceWorker" in navigator && isSecureContext) {
        navigator.serviceWorker.register("sw.js").catch(() => {});
        void persistStorage();
    }

    startCarrying();
    void startSync(store, transport);
}

void boot();
