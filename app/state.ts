import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { computed, signal } from "@preact/signals";
import { buildViews } from "../core/views";
import type { LibraryStore, NodeRole } from "../core/store";
import type { Identity, Op, Presence } from "../core/types";
import type { Directory, HttpTransport, Role } from "../adapters/http-transport";

// Context says WHICH store/adapters this shell uses; signals say WHAT changed.
export const LibraryContext = createContext<LibraryStore>(null!);
export const useLibrary = () => useContext(LibraryContext);
export const TransportContext = createContext<HttpTransport>(null!);
export const useTransport = () => useContext(TransportContext);

export const opLog = signal<Op[]>([]);
export const viewer = signal("");               // this device
export const pending = signal(0);

// What the node says about people here (W-D12): accounts, which devices are whose, groups,
// roles and settings. Kept on the device, so names and rights hold offline too.
export const directory = signal<Directory | null>(null);
// the main library's catalog says who looks after it; the directory adds accounts
export const catalogStewards = signal<string[]>([]);
export const stewards = computed(() => [...catalogStewards.value, ...(directory.value?.stewards ?? [])]);
export const identity = computed<Identity>(() => ({
    devices: directory.value?.devices ?? {},
    groups: Object.fromEntries((directory.value?.groups ?? []).map(g => [g.id, g.members]))
}));
// who this device writes for: its account, or (a guest) itself
export const person = computed(() => identity.value.devices[viewer.value] ?? viewer.value);
// is this user (a device, or an account) the person on this device?
export function isMe(user: string): boolean {
    return (identity.value.devices[user] ?? user) === person.value;
}

// does the person on this device have a steward's say here?
export function isSteward(): boolean {
    return stewards.value.includes(viewer.value) || stewards.value.includes(person.value);
}

// the node has no library by this page's name (deleted, or a mistyped address)
export const missing = signal(false);

// the node says this library needs its password, or an account with a role in it
export const locked = signal(false);
// this device writes for an account that isn't signed in here: its work waits
export const signedOut = computed(() => {
    const d = directory.value;
    const owner = d?.devices?.[viewer.value];
    return !!owner && d?.me?.id !== owner;
});

export const views = computed(() =>
    buildViews(opLog.value, {
        viewer: viewer.value, stewards: stewards.value, identity: identity.value,
        accounts: directory.value?.accounts ?? {}, admin: !!directory.value?.library.roles?.includes("admin")
    }));

export type SyncState = "starting" | "no-node" | "syncing" | "synced" | "offline" | "paused" | "locked";
export const syncState = signal<SyncState>("starting");
export const lastSync = signal<string | null>(null);
export const paused = signal(false);
// which kind of node answered last: the library itself, or a drop point out in the neighbourhood
export const nodeRole = signal<NodeRole>("library");
// handed in at a drop point and not yet seen coming back from the library
export const relayed = signal(0);

// who is here right now, and what the big screen shows. Replaced whole on every poll.
export const presence = signal<Presence>({ online: [], showing: null });
// go wherever the big screen goes
export const follow = signal(false);
// what this device has been paired to do (see You → Pair this device)
export const tokens = signal<Partial<Record<Role, string>>>({});

// the gallery's controls live in the header, so they are shared state
export const query = signal("");
export const medium = signal("all");
// and the gallery's own: which format, and in what order (the order is remembered on this device)
export const format = signal("all");
export type SortKey = "newest" | "oldest" | "title-az" | "title-za" | "author-az" | "author-za" | "uploader-az" | "uploader-za";
export const SORTS: [SortKey, string][] = [
    ["newest", "Newest added"], ["oldest", "Oldest added"],
    ["title-az", "Title A–Z"], ["title-za", "Title Z–A"],
    ["author-az", "Author A–Z"], ["author-za", "Author Z–A"],
    ["uploader-az", "Added by A–Z"], ["uploader-za", "Added by Z–A"]
];
export const sortBy = signal<SortKey>((() => {
    try {
        const v = localStorage.getItem("osl-sort");
        return SORTS.some(([k]) => k === v) ? v as SortKey : "newest";
    } catch {
        return "newest";
    }
})());

// a prompt someone tapped: the note they write next answers it (PromptStrips → the composer)
export const answering = signal<{ documentId: string, noteId: string, name: string } | null>(null);

// one line of feedback for whatever just happened (or failed)
export const notice = signal<{ text: string, error?: boolean } | null>(null);

export function tell(text: string, error = false) {
    notice.value = { text, error };
}

// run an action from a tap, reporting failures instead of swallowing them
export async function attempt<T>(action: () => Promise<T>): Promise<T | undefined> {
    try {
        return await action();
    } catch (e) {
        tell(e instanceof Error ? e.message : String(e), true);
        return undefined;
    }
}
