import type { Op } from "../core/types";
import type { StorageAdapter } from "../core/store";

// Fast-route storage: small (~5 MB per origin) and synchronous, fine for a demo.
// Gate four replaces this with IndexedDBStorage; nothing above the adapter changes.
const PREFIX = "osl:";

export class LocalStorageStorage implements StorageAdapter {
    // throws if the browser blocks storage (some private modes), so callers can fall back
    static available(): boolean {
        try {
            localStorage.setItem(PREFIX + "probe", "1");
            localStorage.removeItem(PREFIX + "probe");
            return true;
        } catch {
            return false;
        }
    }

    async loadOps(): Promise<unknown[]> {
        const raw = localStorage.getItem(PREFIX + "ops");
        if (!raw) return [];
        try {
            const v: unknown = JSON.parse(raw);
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    }

    async appendOps(ops: Op[]): Promise<void> {
        const all = await this.loadOps();
        all.push(...ops);
        write(PREFIX + "ops", JSON.stringify(all));
    }

    async getMeta(key: string): Promise<string | undefined> {
        return localStorage.getItem(PREFIX + "meta:" + key) ?? undefined;
    }

    async setMeta(key: string, value: string): Promise<void> {
        write(PREFIX + "meta:" + key, value);
    }

    async putMedia(hash: string, data: string): Promise<void> {
        write(PREFIX + "media:" + hash, data);
    }

    async getMedia(hash: string): Promise<string | undefined> {
        return localStorage.getItem(PREFIX + "media:" + hash) ?? undefined;
    }
}

function write(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        throw new Error("This phone's storage for the library is full. Try smaller photos, or Save my work and start fresh.", { cause: e });
    }
}
