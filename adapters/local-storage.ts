import type { Op } from "../core/types";
import type { StorageAdapter } from "../core/store";

// Fast-route storage: small (~5 MB per origin) and synchronous, fine for a demo.
// Gate four replaces this with IndexedDBStorage; nothing above the adapter changes.
const PREFIX = "osl:";

export class LocalStorageStorage implements StorageAdapter {
    private prefix: string;

    // one prefix per library: "osl:" for the main one, as before
    constructor(prefix = PREFIX) {
        this.prefix = prefix;
    }

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
        const raw = localStorage.getItem(this.prefix + "ops");
        if (!raw) return [];
        try {
            const v: unknown = JSON.parse(raw);
            return Array.isArray(v) ? v : [];
        } catch {
            return [];
        }
    }

    async appendOps(ops: Op[]): Promise<void> {
        const fresh = new Set(ops.map(o => o.id));
        const all = (await this.loadOps()).filter(o => !fresh.has((o as { id?: string } | null)?.id ?? ""));
        all.push(...ops);
        write(this.prefix + "ops", JSON.stringify(all));
    }

    async getMeta(key: string): Promise<string | undefined> {
        return localStorage.getItem(this.prefix + "meta:" + key) ?? undefined;
    }

    async setMeta(key: string, value: string): Promise<void> {
        write(this.prefix + "meta:" + key, value);
    }

    async putMedia(hash: string, data: string): Promise<void> {
        write(this.prefix + "media:" + hash, data);
    }

    async deleteMedia(hash: string): Promise<void> {
        try { localStorage.removeItem(this.prefix + "media:" + hash); } catch { /* storage blocked */ }
    }

    async getMedia(hash: string): Promise<string | undefined> {
        return localStorage.getItem(this.prefix + "media:" + hash) ?? undefined;
    }
}

function write(key: string, value: string) {
    try {
        localStorage.setItem(key, value);
    } catch (e) {
        throw new Error("This phone's storage for the library is full. Try smaller photos, or Save my work and start fresh.", { cause: e });
    }
}
