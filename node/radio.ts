// The bridge between the library node and the LoRa modem on USB (gate seven).
//
// Inbound:  the modem hands over ops that crossed the radio from a drop point. They are
//           stored like any other push, and only then does the modem hear "durable",
//           so the drop point can let go of its copy.
// Outbound: the return path. The library's ops go out to the drop point one at a time,
//           in log order, so phones out there see the community's additions and see
//           their own notes come back (which is how they learn the notes arrived).
//           Ops that were hidden are never sent; the hide itself is.
//
// The modem speaks one JSON object per line (firmware/src/modem/main.cpp):
//   to the modem    {"t":"send","id":"<op id>","op":{...}}  {"t":"durable","m":<msg>}  {"t":"ping"}
//   from the modem  {"t":"recv","m":<msg>,"op":{...}}  {"t":"sent","id":"<op id>"}  {"t":"hello",...}  {"t":"log","msg":"..."}
//                   {"t":"status","rssi":..,"snr":..,"status":{...}}   a drop point's heartbeat

import { closeSync, createReadStream, openSync, writeSync } from "node:fs";
import { execFileSync } from "node:child_process";
import type { Op } from "../core/types";

const RESEND_MS = 120_000;   // the modem said nothing about the op in flight: offer it again

export type BridgeDeps = {
    log: Op[],                                        // the node's log, in arrival order (read only)
    logId: string,                                    // so a saved position from an earlier log is ignored
    accept(ops: unknown[]): { added: number, rejected: string[] },   // stored on disk before it returns
    loadPosition(): string | null,                    // "<log id>.<n>": how far the return path has sent
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
    let sent = position(d.loadPosition());
    let inflight: { at: number, id: string, sentAt: number } | null = null;   // `at`: index in the log
    let modem: BridgeStatus["modem"] = null;
    let lastHeard: string | null = null;
    let received = 0, delivered = 0;

    function position(saved: string | null): number {
        const dot = saved?.lastIndexOf(".") ?? -1;
        if (!saved || dot <= 0 || saved.slice(0, dot) !== d.logId) return 0;   // another log: start again
        const n = Number(saved.slice(dot + 1));
        return Number.isInteger(n) && n >= 0 && n <= d.log.length ? n : 0;
    }

    const send = (msg: object) => d.write(JSON.stringify(msg) + "\n");

    function hidden(): Set<string> {
        const ids = new Set<string>();
        for (const op of d.log) if (op.type === "hide") ids.add(op.target);
        return ids;
    }

    // Offer the next op to the modem. One in flight at a time; call it often.
    function pump() {
        if (inflight) {
            if (now() - inflight.sentAt < RESEND_MS) return;
            send({ t: "send", id: inflight.id, op: d.log[inflight.at] });
            inflight.sentAt = now();
            return;
        }
        const skip = hidden();
        while (sent < d.log.length) {
            const op = d.log[sent];
            if (skip.has(op.id)) { advance(sent + 1); continue; }   // hidden: never goes out
            inflight = { at: sent, id: op.id, sentAt: now() };
            send({ t: "send", id: op.id, op });
            return;
        }
    }

    function advance(to: number) {
        sent = to;
        d.savePosition(`${d.logId}.${sent}`);
    }

    function onLine(line: string) {
        let msg: Record<string, unknown>;
        try {
            const parsed: unknown = JSON.parse(line);
            if (typeof parsed !== "object" || parsed === null) return;
            msg = parsed as Record<string, unknown>;
        } catch {
            return;   // boot noise from the board
        }
        lastHeard = new Date(now()).toISOString();
        switch (msg.t) {
            case "recv": {
                // Invalid ops are refused but still "durable": keeping them would only make
                // the drop point send them again forever.
                const r = d.accept([msg.op]);
                if (r.rejected.length) say(`radio: refused an op from a drop point (${r.rejected[0]})`);
                received += r.added;
                send({ t: "durable", m: msg.m });
                break;
            }
            case "sent":
                if (inflight && msg.id === inflight.id) {
                    advance(inflight.at + 1);
                    inflight = null;
                    delivered++;
                    pump();
                }
                break;
            case "status":
                d.onStatus?.(msg);
                break;
            case "hello":
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
            waitingToSend: d.log.length - sent
        };
    }

    return { onLine, pump, status };
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
