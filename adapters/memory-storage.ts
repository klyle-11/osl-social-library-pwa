import type { Op } from "../core/types";
import type { StorageAdapter } from "../core/store";

// Nothing survives a reload. For tests, and as the fallback when the browser blocks storage.
export class MemoryStorage implements StorageAdapter {
    ops: Op[] = [];
    meta = new Map<string, string>();
    media = new Map<string, string>();

    async loadOps(): Promise<unknown[]> { return [...this.ops]; }
    async appendOps(ops: Op[]): Promise<void> { this.ops.push(...ops); }
    async getMeta(key: string): Promise<string | undefined> { return this.meta.get(key); }
    async setMeta(key: string, value: string): Promise<void> { this.meta.set(key, value); }
    async putMedia(hash: string, data: string): Promise<void> { this.media.set(hash, data); }
    async getMedia(hash: string): Promise<string | undefined> { return this.media.get(hash); }
}
