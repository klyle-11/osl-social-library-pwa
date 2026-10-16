// Who may do what in a library (docs/libraries-and-accounts.md). Pure functions over the
// registry's records, so they can be tested without a server.

export const ROLES = ["admin", "steward", "presenter", "digitizer", "uploader", "member"] as const;
export type Role = typeof ROLES[number];

// who may add documents and upload files, besides admins and stewards
export const UPLOADERS = ["guests", "accounts", "members", "uploaders", "digitizers", "presenters"] as const;
export type Uploader = typeof UPLOADERS[number];

export type Group = { id: string, name: string, members: string[] };

export type LibraryConfig = {
    id: string,
    name: string,
    created: string,
    password: string | null,        // pbkdf2 hash (node/passwords.ts), null when anyone may open it
    passwordSet: string | null,     // when it was set: changing it locks every session out again
    upload: Uploader[],
    watch: { folder: string } | null,
    roles: Record<string, Role[]>,  // account id -> roles here
    groups: Group[]
};

export type Account = {
    id: string,             // "a-…"
    username: string,       // what they sign in with, lowercase
    name: string,           // what everyone sees
    hash: string,           // node/passwords.ts
    admin: boolean,         // the node admin
    disabled?: boolean,
    created: string,
    devices: string[]       // every device signed in as this account, ever (W-D12: who wrote an op)
};

// A browser, as the node knows it: from its cookie.
export type Session = {
    account: string | null,
    unlocked: Record<string, string>,   // library id -> the passwordSet it was opened with
    created: string,
    seen: string
};

// What someone holds besides their account: a pairing token from the node's screen.
export type Paired = { presenter: boolean, station: boolean };

export const NOT_PAIRED: Paired = { presenter: false, station: false };

export const LIBRARY_ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;
export const USERNAME = /^[a-z0-9][a-z0-9._-]{1,31}$/;

export function rolesOf(lib: LibraryConfig, account: Account | null): Set<Role> {
    if (!account || account.disabled) return new Set();
    if (account.admin) return new Set(ROLES);
    const roles = new Set(lib.roles[account.id] ?? []);
    if (roles.has("admin")) for (const r of ROLES) roles.add(r);
    if (roles.size) roles.add("member");
    return roles;
}

// may this browser open the library at all?
export function mayOpen(lib: LibraryConfig, account: Account | null, session: Session | null): boolean {
    if (!lib.password) return true;
    if (rolesOf(lib, account).size) return true;
    return !!session && !!lib.passwordSet && session.unlocked[lib.id] === lib.passwordSet;
}

export function mayAdminister(lib: LibraryConfig, account: Account | null): boolean {
    return rolesOf(lib, account).has("admin");
}

// may this person add documents and upload files here?
export function mayUpload(lib: LibraryConfig, account: Account | null, paired: Paired = NOT_PAIRED): boolean {
    const roles = rolesOf(lib, account);
    if (roles.has("admin") || roles.has("steward")) return true;
    const who = new Set(lib.upload);
    if (who.has("guests")) return true;
    if (who.has("accounts") && account && !account.disabled) return true;
    if (who.has("members") && roles.has("member")) return true;
    if (who.has("uploaders") && roles.has("uploader")) return true;
    if (who.has("digitizers") && (roles.has("digitizer") || paired.station)) return true;
    if (who.has("presenters") && (roles.has("presenter") || paired.presenter)) return true;
    return false;
}

export function mayPresent(lib: LibraryConfig, account: Account | null, paired: Paired): boolean {
    return paired.presenter || rolesOf(lib, account).has("presenter");
}

// the users whose hides and edits count for anyone's contributions (core/views.ts)
export function stewardsOf(lib: LibraryConfig, accounts: Account[]): string[] {
    return accounts.filter(a => rolesOf(lib, a).has("steward")).map(a => a.id);
}

export function cleanRoles(input: unknown): Role[] {
    return Array.isArray(input) ? ROLES.filter(r => input.includes(r)) : [];
}

export function cleanUploaders(input: unknown): Uploader[] {
    return Array.isArray(input) ? UPLOADERS.filter(u => input.includes(u)) : [];
}
