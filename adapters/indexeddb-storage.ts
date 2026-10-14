import type { Op } from "../core/types";
import type { StorageAdapter } from "../core/store";

// Gate-four storage. Unlike localStorage it has room for photos, saves ops one
// at a time instead of rewriting the whole list, and survives on plain http too.
const NAME = "osl";
const VERSION = 1;

function request<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
}

export class IndexedDBStorage implements StorageAdapter {
    private db: IDBDatabase;

    private constructor(db: IDBDatabase) {
        this.db = db;
    }

    // rejects where the browser blocks IndexedDB (some private modes), so callers can fall back
    static open(): Promise<IndexedDBStorage> {
        return new Promise((resolve, reject) => {
            if (typeof indexedDB === "undefined") { reject(new Error("no IndexedDB")); return; }
            const r = indexedDB.open(NAME, VERSION);
            r.onupgradeneeded = () => {
                const db = r.result;
                if (!db.objectStoreNames.contains("ops")) db.createObjectStore("ops", { keyPath: "id" });
                if (!db.objectStoreNames.contains("meta")) db.createObjectStore("meta");
                if (!db.objectStoreNames.contains("media")) db.createObjectStore("media");
            };
            r.onsuccess = () => resolve(new IndexedDBStorage(r.result));
            r.onerror = () => reject(r.error);
            r.onblocked = () => reject(new Error("the library is open in another tab with an older version"));
        });
    }

    loadOps(): Promise<unknown[]> {
        return request(this.db.transaction("ops").objectStore("ops").getAll());
    }

    // one transaction for the batch: either every op is saved or none is
    appendOps(ops: Op[]): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction("ops", "readwrite");
            const store = tx.objectStore("ops");
            for (const op of ops) store.put(op);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("This device's storage for the library is full."));
        });
    }

    async getMeta(key: string): Promise<string | undefined> {
        return await request(this.db.transaction("meta").objectStore("meta").get(key)) as string | undefined;
    }

    setMeta(key: string, value: string): Promise<void> {
        return this.put("meta", key, value);
    }

    putMedia(hash: string, data: string): Promise<void> {
        return this.put("media", hash, data);
    }

    async getMedia(hash: string): Promise<string | undefined> {
        return await request(this.db.transaction("media").objectStore("media").get(hash)) as string | undefined;
    }

    private put(storeName: string, key: string, value: string): Promise<void> {
        return new Promise((resolve, reject) => {
            const tx = this.db.transaction(storeName, "readwrite");
            tx.objectStore(storeName).put(value, key);
            tx.oncomplete = () => resolve();
            tx.onerror = () => reject(tx.error);
            tx.onabort = () => reject(tx.error ?? new Error("This device's storage for the library is full."));
        });
    }
}
