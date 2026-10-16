// The libraries on this node: their settings (data/libraries.json) and their logs.
// `main` is the library that was here before there were several: its log stays at
// data/ops.jsonl. The others live in data/libraries/<id>/.
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeAside } from "./files";
import { LibraryLog } from "./library-log";
import { hashLibraryPassword } from "./passwords";
import { LIBRARY_ID, cleanUploaders, type LibraryConfig, type Uploader } from "./policy";

export const MAIN = "main";
const MAX_LIBRARIES = 100;
export const MIN_LIBRARY_PASSWORD = 4;

type RegistryFile = {
    revision: number,           // moves on every change here or to accounts: phones refetch the directory
    libraries: LibraryConfig[],
    retired: string[]           // deleted libraries' ids: phones may still hold their ops
};

export class Libraries {
    private data: RegistryFile;
    private logs = new Map<string, LibraryLog>();
    private file: string;
    private dataDir: string;

    constructor(dataDir: string, mainName = "Library") {
        this.dataDir = dataDir;
        this.file = join(dataDir, "libraries.json");
        this.data = readJson<RegistryFile>(this.file, () => ({ revision: 1, libraries: [], retired: [] }));
        this.data.retired ??= [];
        if (!this.get(MAIN)) this.data.libraries.unshift(blank(MAIN, mainName));
        for (const lib of this.data.libraries) {
            lib.upload ??= ["guests"];
            lib.roles ??= {};
            lib.groups ??= [];
            lib.watch ??= null;
        }
        this.save();
        for (const lib of this.data.libraries) this.open(lib.id);
    }

    get revision() { return this.data.revision; }
    list(): LibraryConfig[] { return this.data.libraries; }
    get(id: string): LibraryConfig | null { return this.data.libraries.find(l => l.id === id) ?? null; }
    log(id: string): LibraryLog { return this.logs.get(id)!; }

    dir(id: string) {
        return id === MAIN ? this.dataDir : join(this.dataDir, "libraries", id);
    }

    private open(id: string) {
        const dir = this.dir(id);
        mkdirSync(dir, { recursive: true });
        this.logs.set(id, new LibraryLog({ log: join(dir, "ops.jsonl"), logId: join(dir, "log-id"), conflicts: join(dir, "conflicts.jsonl") }));
    }

    // the reason it can't be made, or the library
    async create(fields: { id: string, name: string, password?: string | null, upload?: unknown }): Promise<LibraryConfig | string> {
        const id = fields.id.trim().toLowerCase();
        if (!LIBRARY_ID.test(id)) return "An id is 1 to 32 lowercase letters, digits and dashes, starting and ending with a letter or digit.";
        if (this.get(id) || this.data.retired.includes(id)) return "That id is taken (or was used by a library that was deleted).";
        if (this.data.libraries.length >= MAX_LIBRARIES) return "This node can't take more libraries.";
        const lib = blank(id, fields.name.trim().slice(0, 80) || id);
        if (fields.upload !== undefined) lib.upload = cleanUploaders(fields.upload);
        if (fields.password) {
            const no = await this.setPassword(lib, fields.password, false);
            if (no) return no;
        }
        this.data.libraries.push(lib);
        this.open(id);
        this.save();
        return lib;
    }

    // null clears it; a string sets it, and locks out every browser that opened it before
    async setPassword(lib: LibraryConfig, password: string | null, save = true): Promise<string | null> {
        if (password !== null && password.length < MIN_LIBRARY_PASSWORD) return `A library's password needs at least ${MIN_LIBRARY_PASSWORD} characters.`;
        lib.password = password === null ? null : await hashLibraryPassword(password);
        lib.passwordSet = password === null ? null : new Date().toISOString();
        if (save) this.save();
        return null;
    }

    update(lib: LibraryConfig, changes: { name?: string, upload?: Uploader[], watch?: { folder: string } | null }) {
        if (changes.name !== undefined) lib.name = changes.name.trim().slice(0, 80) || lib.id;
        if (changes.upload !== undefined) lib.upload = changes.upload;
        if (changes.watch !== undefined) lib.watch = changes.watch;
        this.save();
    }

    // Its folder is moved aside (data/libraries/.deleted/), not erased, and its id is never used again.
    remove(id: string): boolean {
        if (id === MAIN || !this.get(id)) return false;
        this.logs.get(id)?.close();
        this.logs.delete(id);
        const aside = join(this.dataDir, "libraries", ".deleted");
        mkdirSync(aside, { recursive: true });
        const dir = this.dir(id);
        if (existsSync(dir)) renameSync(dir, join(aside, `${id}-${Date.now()}`));
        this.data.libraries = this.data.libraries.filter(l => l.id !== id);
        this.data.retired.push(id);
        this.save();
        return true;
    }

    // settings changed in place (roles, groups): save them and move the revision
    save() {
        this.data.revision++;
        writeAside(this.file, JSON.stringify(this.data, null, 1), 0o600);
    }

    // accounts changed: only the revision moves
    bump() {
        this.save();
    }
}

function blank(id: string, name: string): LibraryConfig {
    return {
        id, name, created: new Date().toISOString(), password: null, passwordSet: null,
        upload: ["guests"], watch: null, roles: {}, groups: []
    };
}
