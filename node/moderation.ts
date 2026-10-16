// Bans, the admin's contact details and takedown requests (docs/moderation.md).
// data/moderation.json holds the bans and the contact; data/takedowns.jsonl the requests.
import { appendFileSync, existsSync, readFileSync, statSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { readJson, writeAside } from "./files";

export type Ban = {
    id: string,
    library: string,        // a library's id, or "*" for every library on the node
    device?: string,        // a device id (guests' and accounts' devices alike)
    ip?: string,            // an address on the network
    account?: string,       // an account
    message: string,        // what the banned person is told ("" for the plain notice)
    contact: boolean,       // and the admin's contact details with it
    by: string,             // the account that banned
    at: string
};

export type Banned = { message: string, contact?: string };

type File = { contact: string, bans: Ban[] };

const MAX_BANS = 5000;
const MAX_TAKEDOWN_FILE = 20 * 1024 * 1024;

export class Moderation {
    private data: File;
    private file: string;

    constructor(file: string) {
        this.file = file;
        this.data = readJson<File>(file, () => ({ contact: "", bans: [] }));
        this.data.bans ??= [];
        this.data.contact ??= "";
    }

    get contact() { return this.data.contact; }
    setContact(text: string) {
        this.data.contact = text.trim().slice(0, 1000);
        this.save();
    }

    // the bans that apply in a library (its own, and those for every library)
    bans(library: string | null): Ban[] {
        return this.data.bans.filter(b => library === null || b.library === library || b.library === "*");
    }

    ban(fields: Omit<Ban, "id" | "at">): Ban | string {
        if (!fields.device && !fields.ip && !fields.account) return "Ban a device, an address or an account.";
        if (this.data.bans.length >= MAX_BANS) return "There are too many bans: lift some first.";
        const ban: Ban = { ...fields, message: fields.message.trim().slice(0, 1000), id: `b-${randomBytes(4).toString("hex")}`, at: new Date().toISOString() };
        this.data.bans.push(ban);
        this.save();
        return ban;
    }

    unban(id: string): boolean {
        const before = this.data.bans.length;
        this.data.bans = this.data.bans.filter(b => b.id !== id);
        if (this.data.bans.length === before) return false;
        this.save();
        return true;
    }

    // the first ban that matches this request in this library, as the banned person is told it
    match(library: string, who: { ip?: string, devices?: string[], account?: string | null }): Banned | null {
        const b = this.data.bans.find(b => (b.library === "*" || b.library === library) && (
            (b.ip && b.ip === who.ip) || (b.device && who.devices?.includes(b.device)) || (b.account && b.account === who.account)));
        if (!b) return null;
        return { message: b.message, ...(b.contact && this.data.contact && { contact: this.data.contact }) };
    }

    private save() {
        writeAside(this.file, JSON.stringify(this.data, null, 1), 0o600);
    }
}

// What anyone may send about something they want taken down. Only admins read them.
export type Takedown = {
    id: string, at: string, library: string,
    name: string, contact: string,
    work: string,           // what it is about: the work, or what's wrong with it
    where: string,          // where it is in the library: titles, links
    kind: "copyright" | "privacy" | "harm" | "other",
    statement: boolean,     // the good-faith and accuracy statements were made
    signature: string,
    from: string            // the address it came from
};

export class Takedowns {
    private file: string;
    constructor(file: string) { this.file = file; }

    add(t: Omit<Takedown, "id" | "at">): Takedown | string {
        if (existsSync(this.file) && statSync(this.file).size > MAX_TAKEDOWN_FILE) return "The requests box is full. Contact the library directly.";
        const entry: Takedown = { ...t, id: `t-${randomBytes(4).toString("hex")}`, at: new Date().toISOString() };
        appendFileSync(this.file, JSON.stringify(entry) + "\n");
        return entry;
    }

    list(library: string | null): Takedown[] {
        if (!existsSync(this.file)) return [];
        return readFileSync(this.file, "utf8").split("\n").filter(Boolean)
            .flatMap(l => { try { return [JSON.parse(l) as Takedown]; } catch { return []; } })
            .filter(t => library === null || t.library === library)
            .reverse();
    }
}
