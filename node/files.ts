import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

// Written aside, then renamed over the old one, so a power cut never leaves half a file.
export function writeAside(file: string, text: string, mode?: number) {
    writeFileSync(file + ".tmp", text, mode === undefined ? undefined : { mode });
    renameSync(file + ".tmp", file);
}

// A settings file the node can't read stops the node: starting without it would write a
// fresh one over it (and, for accounts, hand the node to whoever signs up first).
export function readJson<T>(file: string, fresh: () => T): T {
    if (!existsSync(file)) return fresh();
    try {
        return JSON.parse(readFileSync(file, "utf8")) as T;
    } catch (e) {
        throw new Error(`${file} could not be read (${(e as Error).message}). Fix or move it, then start again.`);
    }
}
