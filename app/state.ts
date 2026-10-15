import { createContext } from "preact";
import { useContext } from "preact/hooks";
import { computed, signal } from "@preact/signals";
import { buildViews } from "../core/views";
import type { LibraryStore, NodeRole } from "../core/store";
import type { Op, Presence } from "../core/types";
import type { HttpTransport, Role } from "../adapters/http-transport";

// Context says WHICH store/adapters this shell uses; signals say WHAT changed.
export const LibraryContext = createContext<LibraryStore>(null!);
export const useLibrary = () => useContext(LibraryContext);
export const TransportContext = createContext<HttpTransport>(null!);
export const useTransport = () => useContext(TransportContext);

export const opLog = signal<Op[]>([]);
export const viewer = signal("");
export const stewards = signal<string[]>([]);
export const pending = signal(0);

export const views = computed(() =>
    buildViews(opLog.value, { viewer: viewer.value, stewards: stewards.value }));

export type SyncState = "starting" | "no-node" | "syncing" | "synced" | "offline" | "paused";
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
