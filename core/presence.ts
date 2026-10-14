import type { Presence, PresenceEntry, Showing } from "./types";

// Presence is the opposite of an op: it is only true right now, so it lives in
// the node's memory and is forgotten. Each device says hello with every poll;
// anyone who hasn't said hello within the window has left.

export const PRESENCE_WINDOW_MS = 10_000;

export type Sighting = { viewing: string, seen: number };

export class PresenceBoard {
    private sightings = new Map<string, Sighting>();
    showing: Showing | null = null;

    // `now` is passed in (milliseconds) so this stays testable with fixed times
    hello(user: string, viewing: string, now: number): void {
        if (!user) return;
        this.sightings.set(user, { viewing, seen: now });
    }

    snapshot(now: number): Presence {
        const online: PresenceEntry[] = [];
        for (const [user, s] of this.sightings) {
            if (now - s.seen > PRESENCE_WINDOW_MS) this.sightings.delete(user);
            else online.push({ user, viewing: s.viewing });
        }
        online.sort((a, b) => (a.user < b.user ? -1 : a.user > b.user ? 1 : 0));
        return { online, showing: this.showing };
    }
}

// Shape check for what arrives over the network; anything odd becomes "nobody".
export function readPresence(input: unknown): Presence {
    const empty: Presence = { online: [], showing: null };
    if (typeof input !== "object" || input === null) return empty;
    const p = input as Record<string, unknown>;
    const online: PresenceEntry[] = [];
    if (Array.isArray(p.online)) {
        for (const e of p.online as Record<string, unknown>[]) {
            if (e && typeof e.user === "string") online.push({ user: e.user, viewing: typeof e.viewing === "string" ? e.viewing : "" });
        }
    }
    let showing: Showing | null = null;
    const s = p.showing as Record<string, unknown> | null | undefined;
    if (s && typeof s.documentId === "string" && typeof s.by === "string" && typeof s.since === "string") {
        showing = { documentId: s.documentId, by: s.by, since: s.since };
    }
    return { online, showing };
}
