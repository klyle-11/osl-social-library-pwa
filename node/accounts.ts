// Accounts (one per node) and sessions (one per browser). docs/libraries-and-accounts.md
import { createHash, randomBytes } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { readJson, writeAside } from "./files";
import { hashAccountPassword, verifyPassword } from "./passwords";
import { USERNAME, type Account, type Session } from "./policy";

const MAX_ACCOUNTS = 10_000;
const MAX_DEVICES = 200;            // per account
const MAX_SESSIONS = 20_000;
export const MIN_PASSWORD = 8;

type AccountsFile = { accounts: Account[], signup: boolean };

export class Accounts {
    private data: AccountsFile;
    private byDevice = new Map<string, string>();
    private file: string;
    private changed: () => void;

    // `changed` runs after every change, so the directory's revision moves (node/libraries.ts)
    constructor(file: string, changed: () => void = () => {}) {
        this.file = file;
        this.changed = changed;
        this.data = readJson<AccountsFile>(file, () => ({ accounts: [], signup: true }));
        this.data.accounts ??= [];
        this.data.signup ??= true;
        for (const a of this.data.accounts) for (const d of a.devices ?? []) this.byDevice.set(d, a.id);
    }

    get count() { return this.data.accounts.length; }
    get signup() { return this.data.signup; }
    list(): Account[] { return this.data.accounts; }
    get(id: string | null | undefined): Account | null { return this.data.accounts.find(a => a.id === id) ?? null; }
    byUsername(username: string): Account | null {
        const u = username.trim().toLowerCase();
        return this.data.accounts.find(a => a.username === u) ?? null;
    }
    // the account a device writes for, if it's signed in
    ownerOf(device: string): string | undefined { return this.byDevice.get(device); }
    devices(): Record<string, string> { return Object.fromEntries(this.byDevice); }

    // The reason it can't be made, or the account. The first one is the node admin.
    async create(fields: { username: string, name: string, password: string }): Promise<Account | string> {
        const username = fields.username.trim().toLowerCase();
        const name = fields.name.trim().slice(0, 80) || username;
        if (!USERNAME.test(username)) return "A username is 2 to 32 letters, digits, dots, dashes or underscores.";
        if (this.byUsername(username)) return "That username is taken.";
        if (fields.password.length < MIN_PASSWORD) return `A password needs at least ${MIN_PASSWORD} characters.`;
        if (this.count >= MAX_ACCOUNTS) return "This library can't take more accounts.";
        const account: Account = {
            id: `a-${randomBytes(5).toString("hex")}`, username, name,
            hash: await hashAccountPassword(fields.password),
            admin: this.count === 0, created: new Date().toISOString(), devices: []
        };
        this.data.accounts.push(account);
        this.save();
        return account;
    }

    // null for a wrong username or password, or a disabled account
    async check(username: string, password: string): Promise<Account | null> {
        const a = this.byUsername(username);
        // a missing account costs the same time as a wrong password, so the answer doesn't say which
        const ok = await verifyPassword(a?.hash ?? DUMMY, password);
        return a && ok && !a.disabled ? a : null;
    }

    // From now on (and for what it wrote before) this device writes for this account.
    link(accountId: string, device: string): "linked" | "taken" | "full" {
        const owner = this.byDevice.get(device);
        if (owner) return owner === accountId ? "linked" : "taken";
        const a = this.get(accountId);
        if (!a) return "taken";
        if (a.devices.length >= MAX_DEVICES) return "full";
        a.devices.push(device);
        this.byDevice.set(device, a.id);
        this.save();
        return "linked";
    }

    async update(id: string, changes: { name?: string, password?: string, admin?: boolean, disabled?: boolean }): Promise<string | null> {
        const a = this.get(id);
        if (!a) return "No such account.";
        if (changes.password !== undefined) {
            if (changes.password.length < MIN_PASSWORD) return `A password needs at least ${MIN_PASSWORD} characters.`;
            a.hash = await hashAccountPassword(changes.password);
        }
        const admins = this.data.accounts.filter(x => x.admin && !x.disabled);
        if ((changes.admin === false || changes.disabled === true) && a.admin && admins.length === 1 && admins[0] === a) {
            return "This is the only node admin. Make someone else an admin first.";
        }
        if (changes.name !== undefined) a.name = changes.name.trim().slice(0, 80) || a.username;
        if (changes.admin !== undefined) a.admin = changes.admin;
        if (changes.disabled !== undefined) a.disabled = changes.disabled || undefined;
        this.save();
        return null;
    }

    setSignup(open: boolean) {
        this.data.signup = open;
        this.save();
    }

    private save() {
        writeAside(this.file, JSON.stringify(this.data), 0o600);
        this.changed();
    }
}

// what a missing account's password is checked against (any valid hash will do)
const DUMMY = "scrypt$16384$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

// ---- sessions: a cookie per browser; the node keeps only its hash ----

const COOKIE = "osl";
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export class Sessions {
    private all = new Map<string, Session>();
    private file: string;
    private dirty = false;
    private timer: ReturnType<typeof setTimeout> | null = null;

    constructor(file: string) {
        this.file = file;
        const saved = readJson<Record<string, Session>>(file, () => ({}));
        for (const [k, s] of Object.entries(saved)) if (s && typeof s === "object") this.all.set(k, { ...s, unlocked: s.unlocked ?? {} });
        // when each browser was last seen is kept in memory and written now and then
        setInterval(() => { if (this.dirty) this.flush(); }, 10 * 60_000).unref();
    }

    get size() { return this.all.size; }

    // the browser's session, if it has one
    read(req: IncomingMessage): Session | null {
        const token = cookie(req.headers.cookie, COOKIE);
        const s = token ? this.all.get(hash(token)) : undefined;
        if (!s) return null;
        s.seen = new Date().toISOString();
        this.dirty = true;
        return s;
    }

    // its session, made now if it has none (unlocking, signing in)
    ensure(req: IncomingMessage, res: ServerResponse, secure: boolean): Session {
        const found = this.read(req);
        if (found) return found;
        const token = randomBytes(32).toString("base64url");
        const now = new Date().toISOString();
        const s: Session = { account: null, unlocked: {}, created: now, seen: now };
        this.all.set(hash(token), s);
        this.trim();
        res.setHeader("set-cookie", `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure ? "; Secure" : ""}`);
        this.changed();
        return s;
    }

    // every session signed in as this account (an account turned off is signed out everywhere)
    signOutEverywhere(accountId: string) {
        for (const s of this.all.values()) if (s.account === accountId) s.account = null;
        this.changed();
    }

    changed() {
        this.dirty = true;
        if (this.timer) return;
        this.timer = setTimeout(() => { this.timer = null; this.flush(); }, 500);
        this.timer.unref?.();
    }

    flush() {
        this.dirty = false;
        writeAside(this.file, JSON.stringify(Object.fromEntries(this.all)), 0o600);
    }

    // too many: forget the guests seen longest ago first
    private trim() {
        if (this.all.size <= MAX_SESSIONS) return;
        const order = [...this.all].sort(([, a], [, b]) =>
            (a.account ? 1 : 0) - (b.account ? 1 : 0) || (a.seen < b.seen ? -1 : 1));
        for (const [k] of order.slice(0, this.all.size - MAX_SESSIONS)) this.all.delete(k);
    }
}

export function cookie(header: string | undefined, name: string): string | null {
    for (const part of (header ?? "").split(";")) {
        const i = part.indexOf("=");
        if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
    }
    return null;
}
