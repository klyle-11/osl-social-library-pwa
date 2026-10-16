// The bridge between the library node and the LoRa modem on USB (gate seven).
//
// Inbound:  the modem hands over ops that crossed the radio from a drop point. They are
//           stored like any other push, and only then does the modem hear "durable",
//           so the drop point can let go of its copy.
// Outbound: the return path. The library's ops go out to the drop point one at a time,
//           in log order, so phones out there see the community's additions and see
//           their own notes come back (which is how they learn the notes arrived).
//           Ops that were hidden are never sent; the hide itself is. Nor are the contents
//           of collections that aren't for everyone (W-D12): they stay at the library.
//
// Several libraries (W-D12): the main one always, and any other the node admin lets drop
// points carry. Their ops take turns on the air, each marked with its library, and the
// drop points get the list (names, and password hashes so they can ask for the password).
//
// The modem speaks one JSON object per line (firmware/lib/osl_modem/src/osl_modem.h):
//   to the modem    {"t":"send","id":"<op id>","op":{...}} (+ "l":"<library>" for another library)
//                   {"t":"libs","libs":[{"id","name","hash"}]}  {"t":"durable","m":<msg>}  {"t":"ping"}
//   from the modem  {"t":"recv","m":<msg>,"op":{...}} (+ "l")  {"t":"sent","id":"<op id>"}  {"t":"hello",...}  {"t":"log","msg":"..."}
//                   {"t":"status","rssi":..,"snr":..,"status":{...}}   a drop point's heartbeat

import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Op } from "../core/types";

const RESEND_MS = 120_000;   // the modem said nothing about the op in flight: offer it again
const LIST_EVERY_MS = 600_000;   // the list goes out when it changes, and now and then for a drop point that missed it
export const MAIN = "main";

// a library the drop points carry
export type RadioLibrary = {
    id: string,
    name: string,
    hash: string | null,                              // its password's PBKDF2 hash (node/passwords.ts), null if open
    log: Op[],                                        // its log, in arrival order (read only)
    logId: string,                                    // so a saved position from an earlier log is ignored
    accept(ops: unknown[]): { added: number, rejected: string[] },   // stored on disk before it returns
    skip?: (op: Op) => boolean                        // never sent: a collection that isn't for everyone
};

export type BridgeDeps = {
    libraries(): RadioLibrary[],                      // the main library first, then any other carried
    loadPosition(): string | null,                    // how far the return path has sent, per library (JSON)
    savePosition(position: string): void,
    write(line: string): void,                        // one line to the modem
    onStatus?: (line: Record<string, unknown>) => void,   // a drop point's heartbeat (node/droppoints.ts)
    now?: () => number,
    say?: (msg: string) => void
};

export type BridgeStatus = {
    modem: { radio: boolean, rssi?: number, snr?: number, stats?: unknown } | null,
    lastHeardFromModem: string | null,
    receivedFromDropPoint: number,
    sentToDropPoint: number,
    waitingToSend: number
};

export function createBridge(d: BridgeDeps) {
    const now = d.now ?? Date.now;
    const say = d.say ?? console.log;
    const saved = parsePositions(d.loadPosition());
    const sent = new Map<string, number>();            // library -> how far its return path has gone
    let inflight: { lib: string, at: number, id: string, sentAt: number } | null = null;   // `at`: index in its log
    let modem: BridgeStatus["modem"] = null;
    let lastHeard: string | null = null;
    let received = 0, delivered = 0, turn = 0;
    let listSent = "", listAt = -Infinity;

    // where a library's return path is: its saved position if it is from this log, else the start
    function position(lib: RadioLibrary): number {
        if (sent.has(lib.id)) return sent.get(lib.id)!;
        const p = saved[lib.id];
        const dot = p?.lastIndexOf(".") ?? -1;
        let n = 0;
        if (p && dot > 0 && p.slice(0, dot) === lib.logId) {
            const v = Number(p.slice(dot + 1));
            if (Number.isInteger(v) && v >= 0 && v <= lib.log.length) n = v;
        }
        sent.set(lib.id, n);
        return n;
    }

    const send = (msg: object) => d.write(JSON.stringify(msg) + "\n");

    function hidden(lib: RadioLibrary): Set<string> {
        const ids = new Set<string>();
        for (const op of lib.log) if (op.type === "hide") ids.add(op.target);
        return ids;
    }

    // the libraries drop points carry, their names and password hashes: when it changes, and now and then
    function sendList(libs: RadioLibrary[]) {
        const list = libs.map(l => ({ id: l.id, name: l.name, hash: l.hash ?? "" }));
        const text = JSON.stringify(list);
        if (text === listSent && now() - listAt < LIST_EVERY_MS) return;
        send({ t: "libs", libs: list });
        listSent = text;
        listAt = now();
    }

    // Offer the next op to the modem, the libraries taking turns. One in flight at a time; call it often.
    function pump() {
        const libs = d.libraries();
        sendList(libs);
        if (inflight) {
            const lib = libs.find(l => l.id === inflight!.lib);
            if (!lib) { inflight = null; return pump(); }   // no longer carried
            if (now() - inflight.sentAt < RESEND_MS) return;
            send(line(lib, lib.log[inflight.at]));
            inflight.sentAt = now();
            return;
        }
        for (let k = 0; k < libs.length; k++) {
            const lib = libs[(turn + k) % libs.length];
            const skip = hidden(lib);
            let at = position(lib);
            while (at < lib.log.length) {
                const op = lib.log[at];
                if (skip.has(op.id) || lib.skip?.(op)) { advance(lib, ++at); continue; }   // hidden or not for everyone: never goes out
                inflight = { lib: lib.id, at, id: op.id, sentAt: now() };
                turn = (turn + k + 1) % libs.length;
                send(line(lib, op));
                return;
            }
        }
    }

    function line(lib: RadioLibrary, op: Op) {
        return lib.id === MAIN ? { t: "send", id: op.id, op } : { t: "send", id: op.id, l: lib.id, op };
    }

    function advance(lib: RadioLibrary, to: number) {
        sent.set(lib.id, to);
        saved[lib.id] = `${lib.logId}.${to}`;
        d.savePosition(JSON.stringify(saved));
    }

    function onLine(text: string) {
        let msg: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(text);
            if (typeof parsed !== "object" || parsed === null) return;
            msg = parsed as Record<string, unknown>;
        } catch {
            return;   // boot noise from the board
        }
        lastHeard = new Date(now()).toISOString();
        switch (msg.t) {
            case "recv": {
                // Invalid ops are refused but still "durable": keeping them would only make
                // the drop point send them again forever. So are ops for a library not carried.
                const id = typeof msg.l === "string" ? msg.l : MAIN;
                const lib = d.libraries().find(l => l.id === id);
                if (!lib) {
                    say(`radio: refused an op for "${id}", which drop points don't carry`);
                } else {
                    const r = lib.accept([msg.op]);
                    if (r.rejected.length) say(`radio: refused an op from a drop point (${r.rejected[0]})`);
                    received += r.added;
                }
                send({ t: "durable", m: msg.m });
                break;
            }
            case "sent":
                if (inflight && msg.id === inflight.id) {
                    const lib = d.libraries().find(l => l.id === inflight!.lib);
                    if (lib) advance(lib, inflight.at + 1);
                    inflight = null;
                    delivered++;
                    pump();
                }
                break;
            case "status":
                d.onStatus?.(msg);
                break;
            case "hello":
                // a modem that just started (or was plugged back in) may have lost the list: it goes again
                if (!modem) listSent = "";
                modem = { radio: msg.radio === true, rssi: msg.rssi as number, snr: msg.snr as number, stats: msg.stats };
                if (msg.radio !== true) say("radio: the modem says its radio did not start (check its pins)");
                break;
            case "log":
                say(`modem: ${String(msg.msg)}`);
                break;
        }
    }

    function status(): BridgeStatus {
        return {
            modem, lastHeardFromModem: lastHeard,
            receivedFromDropPoint: received, sentToDropPoint: delivered,
            waitingToSend: d.libraries().reduce((n, l) => n + l.log.length - position(l), 0)
        };
    }

    return { onLine, pump, status };
}

// {"main":"<log id>.<n>", ...}; from before there were several, the main library's alone
function parsePositions(text: string | null): Record<string, string> {
    if (!text) return {};
    if (!text.startsWith("{")) return { [MAIN]: text.trim() };
    try {
        const v = JSON.parse(text) as Record<string, unknown>;
        return Object.fromEntries(Object.entries(v).filter((e): e is [string, string] => typeof e[1] === "string"));
    } catch {
        return {};
    }
}

export type Bridge = ReturnType<typeof createBridge>;

// Opens the modem's serial port (Linux and macOS, no dependencies) and runs the bridge.
// Reconnects by itself when the modem is unplugged and plugged back in.
export function startRadio(port: string, deps: Omit<BridgeDeps, "write">): Bridge {
    let fd: number | null = null;
    let buf = "";
    const say = deps.say ?? console.log;

    const close = () => {
        if (fd !== null) { try { closeSync(fd); } catch { /* already gone */ } }
        fd = null;
    };
    const write = (line: string) => {
        if (fd === null) return;
        try { writeSync(fd, line); } catch (e) { say(`radio: write failed (${(e as Error).message})`); close(); }
    };
    const bridge = createBridge({ ...deps, write });

    const open = () => {
        try {
            execFileSync("stty", [process.platform === "darwin" ? "-f" : "-F", port, "115200", "raw", "-echo", "-echoe", "-echok", "-hupcl"]);
            fd = openSync(port, "r+");
        } catch {
            fd = null;
            setTimeout(open, 5000);
            return;
        }
        say(`radio: modem connected on ${port}`);
        const stream = createReadStream("", { fd, autoClose: false });
        stream.on("data", chunk => {
            buf += chunk.toString();
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (line) bridge.onLine(line);
            }
        });
        const lost = () => {
            if (fd === null) return;   // "error" and "end" can both come: reconnect once
            say("radio: modem disconnected; trying again");
            close();
            setTimeout(open, 5000);
        };
        stream.on("error", lost);
        stream.on("end", lost);
        write(JSON.stringify({ t: "ping" }) + "\n");
    };
    open();
    setInterval(() => { if (fd !== null) bridge.pump(); }, 2000).unref();
    return bridge;
}
