import type { Op, OpId, Presence } from "../core/types";
import type { NodeRole, PushReply, Transport } from "../core/store";
import { readPresence } from "../core/presence";

export type Role = "presenter" | "station";
export type NodeInfo = { secure: boolean, addresses: string[], host: string };
export type Uploaded = { hash: string, size: number, fileType: string };

// Talks to the node's sync endpoint. Paths are relative so the app works
// from any address the node is reached at.
export class HttpTransport implements Transport {
    private base: string;

    // Who this device is and what it has open. It rides along on every pull, and
    // the answer says who else is here: presence costs no extra requests.
    hello: { user: string, viewing: string } | null = null;
    onPresence: ((presence: Presence) => void) | null = null;

    constructor(base = "api/") {
        this.base = base;
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
        const body = await this.send("ops", { ops }) as { keep?: unknown, node?: { role?: unknown } } | null;
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
        const res = await fetch(`${this.base}ops?${query}`, { cache: "no-store" });
        if (!res.ok) throw new Error(`pull failed: ${res.status}`);
        const body = await res.json() as { ops?: unknown[], cursor?: string, presence?: unknown, node?: { role?: unknown } };
        this.role = body.node?.role === "droppoint" ? "droppoint" : "library";
        this.onPresence?.(readPresence(body.presence));
        return { ops: Array.isArray(body.ops) ? body.ops : [], cursor: String(body.cursor ?? cursor) };
    }

    // false when this node doesn't keep files (a drop point answers 507 with noMedia)
    async pushMedia(hash: string, data: string): Promise<boolean> {
        const res = await fetch(this.base + "media", {
            method: "POST",
            headers: { "content-type": "application/json" },
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

    // trade the code on the node's screen for a token this device keeps
    async pair(code: string, role: Role): Promise<string> {
        const body = await this.send("pair", { code: code.trim(), role }) as { token?: string };
        if (!body.token) throw new Error("The node didn't answer with a pairing.");
        return body.token;
    }

    async show(token: string, documentId: string | null, user: string): Promise<void> {
        await this.send("showing", { token, documentId, user });
    }

    // Whole files from the digitization station. XMLHttpRequest because fetch
    // can't report upload progress, and a film takes long enough to need it.
    upload(file: File, token: string, onProgress: (fraction: number) => void): Promise<Uploaded> {
        return new Promise((resolve, reject) => {
            const xhr = new XMLHttpRequest();
            xhr.open("POST", this.base + "upload");
            xhr.setRequestHeader("content-type", file.type || "application/octet-stream");
            xhr.setRequestHeader("x-osl-token", token);
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

    private async send(path: string, body: unknown): Promise<unknown> {
        const res = await fetch(this.base + path, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body)
        });
        const text = await res.text();
        let parsed: unknown = null;
        try { parsed = JSON.parse(text); } catch { /* plain text error */ }
        if (!res.ok) {
            const message = (parsed as { error?: string } | null)?.error;
            throw new Error(message ?? `${path} failed: ${res.status} ${text}`);
        }
        return parsed;
    }
}
