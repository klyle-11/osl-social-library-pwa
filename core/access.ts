import type { Identity } from "./types";

// Who counts as whom, and who is in an audience. The views use these on every device,
// and the node uses the same ones to decide what to send to whom.

export const NO_IDENTITY: Identity = { devices: {}, groups: {} };

// A device signed in to an account is that account; any other device is its own person.
export function personOf(identity: Identity, user: string): string {
    return identity.devices[user] ?? user;
}

export function isAccount(id: string): boolean {
    return id.startsWith("a-");
}

export function isGroup(id: string): boolean {
    return id.startsWith("g-");
}

// "everyone" | "owner" | "people:<id>,<id>", where an id is an account or a group
export type Audience = { kind: "everyone" } | { kind: "owner" } | { kind: "people", ids: string[] };

export const EVERYONE: Audience = { kind: "everyone" };
export const OWNER: Audience = { kind: "owner" };

// null for anything else; the op carrying it is ignored
export function parseAudience(value: string | undefined): Audience | null {
    if (value === "everyone") return EVERYONE;
    if (value === "owner") return OWNER;
    if (value?.startsWith("people:")) return { kind: "people", ids: [...new Set(value.slice(7).split(",").map(s => s.trim()).filter(Boolean))] };
    return null;
}

export function formatAudience(a: Audience): string {
    return a.kind === "people" ? `people:${a.ids.join(",")}` : a.kind;
}

// Is this person in it? The owner always is. `person` is already resolved (personOf).
// A guest's device id can be listed (who may edit a document's details, from before
// accounts), but only accounts are in groups.
export function inAudience(a: Audience, person: string, owner: string, identity: Identity): boolean {
    if (person === owner || a.kind === "everyone") return true;
    if (a.kind === "owner") return false;
    return a.ids.some(id => id === person || (isGroup(id) && (identity.groups[id] ?? []).includes(person)));
}
