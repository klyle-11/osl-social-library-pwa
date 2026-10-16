import { render } from "preact";
import { LibraryStore, type StorageAdapter } from "../core/store";
import { readCatalog } from "../core/bundle";
import { IndexedDBStorage } from "../adapters/indexeddb-storage";
import { LocalStorageStorage } from "../adapters/local-storage";
import { MemoryStorage } from "../adapters/memory-storage";
import { HttpTransport } from "../adapters/http-transport";
import { newDeviceId, now, recall } from "../adapters/device";
import { persistStorage } from "../adapters/carry";
import { effect } from "@preact/signals";
import { TransportContext, catalogStewards, opLog, pending, tell, tokens, viewer } from "./state";
import { startCarrying, startSync } from "./sync";
import { startTheme } from "./theme";
import { startPlayer } from "./player";
import { views } from "./state";
import { MAIN, libraryId, storageName } from "./library";
import { keptDirectory, startDirectory } from "./people";
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
    startTheme();
    startPlayer(id => views.value.documents[id]);
    // this shell's adapters, best first. Nothing above this line of code knows which one it got.
    // Each library keeps its own (app/library.ts).
    const storage: StorageAdapter = await IndexedDBStorage.open(storageName()).catch(() =>
        LocalStorageStorage.available() ? new LocalStorageStorage(libraryId === MAIN ? "osl:" : `osl:lib:${libraryId}:`) : new MemoryStorage());
    const store = new LibraryStore(storage, { now, newDeviceId });
    const transport = new HttpTransport("api/", libraryId);
    tokens.value = {
        ...(recall("token:presenter") && { presenter: recall("token:presenter")! }),
        ...(recall("token:station") && { station: recall("token:station")! })
    };
    effect(() => { transport.tokens = Object.values(tokens.value).filter((t): t is string => !!t); });

    // the catalog (library/documents.json) is the main library's
    const catalog = libraryId === MAIN ? await loadCatalog() : readCatalog(null);
    catalogStewards.value = catalog.stewards;
    await store.open(catalog.ops);
    await keptDirectory(store, storage);

    viewer.value = store.user;
    opLog.value = store.ops;
    pending.value = store.outbox.length;
    store.subscribe(() => { opLog.value = store.ops; viewer.value = store.user; });

    // Preact renders beside what's already in the container, so the "Opening the library…"
    // placeholder from index.html goes first
    const root = document.getElementById("app")!;
    root.replaceChildren();
    render(
        <TransportContext.Provider value={transport}><Library store={store} /></TransportContext.Provider>,
        root
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
    void startDirectory(store, transport, storage);
    void startSync(store, transport);
}

void boot();
