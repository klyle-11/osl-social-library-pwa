import type { Op, OpId, Presence } from "../core/types";
import type { NodeRole, PushReply, Transport } from "../core/store";
import { readPresence } from "../core/presence";

// What the node says about people in a library (W-D12, node/server.ts directory()).
export type LibraryRole = "admin" | "steward" | "presenter" | "digitizer" | "uploader" | "member";
export type Uploader = "guests" | "accounts" | "members" | "uploaders" | "digitizers" | "presenters";
export type Group = { id: string, name: string, members: string[] };
export type Me = { id: string, username: string, name: string, admin: boolean };
export type Directory = {
    revision: number,
    libraries: { id: string, name: string, protected: boolean, open: boolean }[],
    me: Me | null,
    signup: boolean,
    setup: boolean,     // no accounts yet: the first needs the pairing code, and looks after the node
    library: {
        id: string, name: string, protected: boolean, locked: boolean,
        upload?: Uploader[], mayUpload?: boolean, roles?: LibraryRole[], watch?: { folder: string } | null
    },
    accounts?: Record<string, string>,      // account id -> name
    devices?: Record<string, string>,       // device id -> account id
    groups?: Group[],
    stewards?: string[],
    roles?: Record<string, LibraryRole[]>   // for this library's admins
};
export type AccountInfo = { id: string, username: string, name: string, admin?: boolean, disabled?: boolean, created?: string, devices?: number };

// The node said this library needs its password (or an account with a role in it).
export class LockedError extends Error {
    constructor(message: string) { super(message); this.name = "LockedError"; }
}

export type Role = "presenter" | "station";
export type NodeInfo = { secure: boolean, addresses: string[], host: string };
export type Uploaded = { hash: string, size: number, fileType: string };
export type Suggestion = { kind: string, text: string, contact?: string, page?: string, device?: string, app?: string, via?: string };

// What the library says about itself and every drop point it has heard (node/droppoints.ts).
export type Signal = { rssi: number, snr: number };
export type DropPointInfo = {
    id: string, name: string, state: "connected" | "not-heard", firstSeen: string, lastHeard: string,
    every: number, up: number, waiting: number, ops: number, flashFree: number, phones: number,
    app: string, sameApp: boolean | null, atLibrary: Signal | null, atDropPoint: Signal | null
};
export type DropPointsInfo = {
    library: {
        app: string, phones: number,
        radio: { port: string, connected: boolean, working: boolean | null, lastHeard: string | null, waitingToSend: number } | null
    },
    droppoints: DropPointInfo[]
};

// Talks to the node's sync endpoint. Paths are relative so the app works
// from any address the node is reached at. Every request about another library than the
// main one says which (api/l/<id>/…); the main library's paths are the ones drop points know.
export class HttpTransport implements Transport {
    private base: string;
    private library: string;

    // Who this device is and what it has open. It rides along on every pull, and
    // the answer says who else is here: presence costs no extra requests.
    hello: { user: string, viewing: string } | null = null;
    onPresence: ((presence: Presence) => void) | null = null;
    // the node's directory changed (who is who, roles, settings): ask for it again
    onDirectory: ((revision: number) => void) | null = null;
    // what this device last heard about who may see which collections; the node sends
    // a collection's earlier ops again when that has moved (kept across visits)
    access: string;
    // the pairing tokens this device holds: they count for who may add documents
    tokens: string[] = [];

    constructor(base = "api/", library = "main") {
        this.base = base;
        this.library = library;
        this.access = read("osl-access:" + library) ?? "";
    }

    // Another library's API is under api/l/<id>/: a drop point that only carries the main
    // library answers 404 there, instead of taking the notes into the wrong library.
    private url(path: string, query?: URLSearchParams): string {
        const s = new URLSearchParams(query).toString();
        const scope = this.library === "main" ? "" : `l/${encodeURIComponent(this.library)}/`;
        return this.base + scope + path + (s ? "?" + s : "");
    }

    // is there a node here at all? (a static host has no api)
    async available(): Promise<boolean> {
        try {
            const res = await fetch(this.base + "health", { cache: "no-store" });
            return res.ok;
        } catch {
            return false;
        }
    }

    // which kind of node answered last: the library, or a drop point out in the neighbourhood
    role: NodeRole = "library";

    async pushOps(ops: Op[]): Promise<PushReply> {
        const body = await this.send("ops", { ops }, true) as { keep?: unknown, node?: { role?: unknown } } | null;
        const keep = Array.isArray(body?.keep) ? body.keep.filter((id): id is OpId => typeof id === "string") : [];
        this.role = body?.node?.role === "droppoint" ? "droppoint" : "library";
        return { keep, role: this.role };
    }

    async pullOps(cursor: string): Promise<{ ops: unknown[], cursor: string }> {
        const query = new URLSearchParams({ after: cursor });
        if (this.hello) {
            query.set("user", this.hello.user);
            query.set("viewing", this.hello.viewing);
        }
        if (this.access) query.set("access", this.access);
        const res = await fetch(this.url("ops", query), { cache: "no-store" });
        if (res.status === 401) throw new LockedError(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "This library is protected.");
        if (!res.ok) throw new Error(`pull failed: ${res.status}`);
        const body = await res.json() as { ops?: unknown[], cursor?: string, presence?: unknown, node?: { role?: unknown }, directory?: unknown, access?: unknown };
        this.role = body.node?.role === "droppoint" ? "droppoint" : "library";
        this.onPresence?.(readPresence(body.presence));
        if (typeof body.directory === "number") this.onDirectory?.(body.directory);
        if (typeof body.access === "string" && body.access !== this.access) {
            this.access = body.access;
            write("osl-access:" + this.library, body.access);
        }
        return { ops: Array.isArray(body.ops) ? body.ops : [], cursor: String(body.cursor ?? cursor) };
    }

    // false when this node doesn't keep files (a drop point answers 507 with noMedia)
    async pushMedia(hash: string, data: string): Promise<boolean> {
        const res = await fetch(this.url("media"), {
            method: "POST",
            headers: { "content-type": "application/json", ...(this.tokens.length && { "x-osl-token": this.tokens.join(",") }) },
            body: JSON.stringify({ hash, data })
        });
        if (res.ok) return true;
        const body = await res.json().catch(() => null) as { error?: string, noMedia?: boolean } | null;
        if (res.status === 507 && body?.noMedia) return false;
        throw new Error(body?.error ?? `media failed: ${res.status}`);
    }

    async info(): Promise<NodeInfo | null> {
        try {
            const res = await fetch(this.base + "info", { cache: "no-store" });
            return res.ok ? await res.json() as NodeInfo : null;
        } catch {
            return null;
        }
    }

    // "elsewhere": this is a drop point, which keeps no list; null: no answer at all
    async dropPoints(): Promise<DropPointsInfo | "elsewhere" | null> {
        try {
            const res = await fetch(this.base + "droppoints", { cache: "no-store" });
            if (res.status === 404) return "elsewhere";
            if (!res.ok) return null;
            const body = await res.json() as DropPointsInfo;
            return body && body.library && Array.isArray(body.droppoints) ? body : null;
        } catch {
            return null;
        }
    }

    async forgetDropPoint(token: string, id: string): Promise<void> {
        await this.send("droppoints/forget", { token, id });
    }

    // trade the code on the node's screen for a token this device keeps
    async pair(code: string, role: Role): Promise<string> {
        const body = await this.send("pair", { code: code.trim(), role }) as { token?: string };
        if (!body.token) throw new Error("The node didn't answer with a pairing.");
        return body.token;
    }

    async show(token: string, documentId: string | null, user: string): Promise<void> {
        await this.send("showing", { token, documentId, user }, true);
    }

    // ---- people (W-D12) ----

    // null: no node answered (offline, or a drop point, which keeps no accounts)
    async directory(): Promise<Directory | null> {
        try {
            const res = await fetch(this.url("directory"), { cache: "no-store" });
            const body = await res.json().catch(() => null) as Directory | null;
            return body && Array.isArray(body.libraries) && body.library ? body : null;
        } catch {
            return null;
        }
    }

    unlock(password: string) { return this.send("unlock", { password }, true); }
    lock() { return this.send("lock", {}, true); }

    // `linked`: what became of this device: "linked", or "taken" (it writes for someone else: start a new one)
    async signIn(username: string, password: string, device: string): Promise<{ linked: string | null }> {
        return await this.send("account/signin", { username, password, device }) as { linked: string | null };
    }
    async signUp(fields: { username: string, name: string, password: string, code?: string, device?: string, signIn?: boolean }): Promise<{ account: string, linked: string | null }> {
        return await this.send("account/signup", fields) as { account: string, linked: string | null };
    }
    async link(device: string): Promise<string> {
        return ((await this.send("account/link", { device })) as { linked: string }).linked;
    }
    signOut() { return this.send("account/signout", {}); }
    updateAccount(changes: { name?: string, password?: string, current?: string }) { return this.send("account/update", changes); }

    async accounts(): Promise<{ accounts: AccountInfo[], signup?: boolean }> {
        const res = await fetch(this.base + "accounts", { cache: "no-store" });
        const body = await res.json().catch(() => ({})) as { accounts?: AccountInfo[], signup?: boolean, error?: string };
        if (!res.ok) throw new Error(body.error ?? `accounts: ${res.status}`);
        return { accounts: body.accounts ?? [], signup: body.signup };
    }
    changeAccount(id: string, changes: { name?: string, password?: string, admin?: boolean, disabled?: boolean }) {
        return this.send("accounts/update", { id, ...changes });
    }
    setSignup(open: boolean) { return this.send("accounts/signup", { open }); }

    async createLibrary(fields: { id: string, name: string, password?: string, upload?: Uploader[] }): Promise<string> {
        return ((await this.send("libraries/create", fields)) as { id: string }).id;
    }
    // each answers with this library's directory as it now stands
    async librarySettings(changes: { name?: string, password?: string | null, upload?: Uploader[], watch?: string | null }): Promise<Directory> {
        return await this.send("libraries/settings", changes, true) as Directory;
    }
    async setRoles(account: string, roles: LibraryRole[]): Promise<Directory> {
        return await this.send("libraries/roles", { account, roles }, true) as Directory;
    }
    async saveGroup(group: { id?: string, name?: string, members?: string[], delete?: boolean }): Promise<Directory> {
        return await this.send("libraries/groups", group, true) as Directory;
    }
    deleteLibrary() { return this.send("libraries/delete", {}, true); }

    // Whole files. The device's pairing tokens count where only presenters or digitizers
    // may add documents. XMLHttpRequest because fetch can't report upload progress, and
    // a film takes long enough to need it.
    upload(file: File, onProgress: (fraction: number) => void): Promise<Uploaded> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", this.url("upload"));
            xhr.setRequestHeader("content-type", fileTypeOf(file));
            if (this.tokens.length) xhr.setRequestHeader("x-osl-token", this.tokens.join(","));
            xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(e.loaded / e.total); };
            xhr.onerror = () => reject(new Error("The upload was interrupted. Check the connection and try again."));
            xhr.onload = () => {
                let body: { error?: string } & Partial<Uploaded> = {};
                try { body = JSON.parse(xhr.responseText); } catch { /* not json: fall through to the status */ }
                if (xhr.status === 200 && body.hash && body.fileType) resolve(body as Uploaded);
                else reject(new Error(body.error ?? `upload failed: ${xhr.status}`));
            };
            xhr.send(file);
        });
    }

    // to the developer only: never part of the op log
    async suggest(suggestion: Suggestion): Promise<void> {
        await this.send("suggestions", suggestion);
    }

    async suggestions(key: string): Promise<(Suggestion & { id: string, receivedAt: string })[]> {
        const res = await fetch(this.base + "suggestions", { headers: { "x-osl-key": key } });
        const body = await res.json().catch(() => ({})) as { suggestions?: (Suggestion & { id: string, receivedAt: string })[], error?: string };
        if (!res.ok) throw new Error(body.error ?? `suggestions: ${res.status}`);
        return body.suggestions ?? [];
    }

    // `scoped`: about this library (the node is told which)
    private async send(path: string, body: unknown, scoped = false): Promise<unknown> {
        const res = await fetch(scoped ? this.url(path) : this.base + path, {
            method: "POST",
            headers: { "content-type": "application/json", ...(this.tokens.length && { "x-osl-token": this.tokens.join(",") }) },
            body: JSON.stringify(body)
        });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { /* plain text error */ }
        if (!res.ok) {
            const message = (parsed as { error?: string } | null)?.error;
            if (res.status === 401 && (parsed as { locked?: boolean } | null)?.locked) throw new LockedError(message ?? "This library is protected.");
            throw new Error(message ?? `${path} failed: ${res.status} ${text}`);
        }
        return parsed;
    }
}

function read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function write(key: string, value: string) {
    try { localStorage.setItem(key, value); } catch { /* asked again next visit */ }
}

// Phones often leave an EPUB's type blank (and some send PDFs as octet-stream): go by the name.
export function fileTypeOf(file: File): string {
    const ext = file.name.slice(file.name.lastIndexOf(".") + 1).toLowerCase();
    if (ext === "epub") return "application/epub+zip";
    if (ext === "pdf") return "application/pdf";
    return file.type || "application/octet-stream";
}
