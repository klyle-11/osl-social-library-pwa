// The library's list of drop points: every one it has ever heard, with when it last
// heard it and what it said. A drop point says so every few minutes by radio (its
// heartbeat, firmware/lib/osl_node/src/osl_status.h); one that falls silent for a
// few of its own intervals is listed as not heard since then, and stays listed.
//
// Kept in data/droppoints.json. What a drop point says is untrusted: it crosses an
// open radio channel, so every field is checked and bounded before it is kept.

export type Signal = { rssi: number, snr: number };

export type DropPoint = {
    id: string,              // "drop-a1b2c3"
    name: string,            // DROP_NAME on the board
    firstSeen: string,       // ISO time
    lastHeard: string,
    every: number,           // seconds between heartbeats
    up: number,              // seconds since it started, when last heard
    waiting: number,         // phones' ops it holds that haven't crossed yet
    ops: number,
    flashFree: number,
    phones: number,
    app: string,             // the app version in its flash
    atLibrary: Signal | null,    // how the library's modem heard it
    atDropPoint: Signal | null   // how it hears the library
};

export type DropPointView = DropPoint & {
    state: "connected" | "not-heard",
    sameApp: boolean | null      // null when either version is unknown
};

const MAX_POINTS = 64;           // a bound on what an open radio channel can add
const ID = /^[a-z0-9-]{1,40}$/;

const num = (v: unknown, min: number, max: number): number | null =>
    typeof v === "number" && Number.isFinite(v) && v >= min && v <= max ? v : null;
const text = (v: unknown, max: number): string =>
    typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, max) : "";
const signal = (rssi: unknown, snr: unknown): Signal | null => {
    const r = num(rssi, -200, 50), s = num(snr, -50, 50);
    return r === null || s === null ? null : { rssi: r, snr: s };
};

export class DropPointRegister {
    private points = new Map<string, DropPoint>();
    private save: (json: string) => void;

    constructor(saved: string | null, save: (json: string) => void) {
        this.save = save;
        if (!saved) return;
        try {
            const list: unknown = JSON.parse(saved);
            if (Array.isArray(list)) for (const p of list as DropPoint[]) if (p && ID.test(p.id)) this.points.set(p.id, p);
        } catch { /* an unreadable file starts an empty list; the drop points fill it again */ }
    }

    // A heartbeat line from the modem: {"t":"status","rssi":..,"snr":..,"status":{...}}.
    // Returns false if it wasn't one worth keeping.
    heard(line: { rssi?: unknown, snr?: unknown, status?: unknown }, now: Date): boolean {
        const s = line.status as Record<string, unknown> | null | undefined;
        if (typeof s !== "object" || s === null) return false;
        const id = text(s.id, 40);
        if (!ID.test(id)) return false;
        if (!this.points.has(id) && this.points.size >= MAX_POINTS) return false;
        const at = now.toISOString();
        const old = this.points.get(id);
        this.points.set(id, {
            id,
            name: text(s.name, 60) || id,
            firstSeen: old?.firstSeen ?? at,
            lastHeard: at,
            every: num(s.every, 1, 86_400) ?? 120,
            up: num(s.up, 0, 10 * 365 * 86_400) ?? 0,
            waiting: num(s.waiting, 0, 1e7) ?? 0,
            ops: num(s.ops, 0, 1e9) ?? 0,
            flashFree: num(s.flashFree, 0, 1e10) ?? 0,
            phones: num(s.phones, 0, 1000) ?? 0,
            app: /^[0-9a-f]{1,64}$/.test(String(s.app)) ? String(s.app) : "",
            atLibrary: signal(line.rssi, line.snr),
            atDropPoint: signal(s.rssi, s.snr)
        });
        this.save(JSON.stringify([...this.points.values()], null, 1));
        return true;
    }

    // Connected while heard within a few of its own intervals: one lost heartbeat is
    // normal on a radio link, and it waits behind a note being sent.
    list(now: Date, libraryApp: string): DropPointView[] {
        return [...this.points.values()]
            .map(p => {
                const silent = (now.getTime() - Date.parse(p.lastHeard)) / 1000;
                const state: DropPointView["state"] = silent <= Math.max(p.every * 2.5, p.every + 10) ? "connected" : "not-heard";
                const sameApp = p.app && libraryApp ? p.app === libraryApp : null;
                return { ...p, state, sameApp };
            })
            .sort((a, b) => (a.state === b.state ? a.name.localeCompare(b.name) : a.state === "connected" ? -1 : 1));
    }

    // Take one off the list (it was moved, or retired). It reappears if it is heard again.
    forget(id: string): boolean {
        const gone = this.points.delete(id);
        if (gone) this.save(JSON.stringify([...this.points.values()], null, 1));
        return gone;
    }
}
