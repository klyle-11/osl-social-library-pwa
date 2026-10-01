// Bridge between the archive node and the LoRa modem on USB serial (gate seven).
//
// Inbound:  the modem hands over ops that crossed the radio from the drop point.
//           They are stored like any other sync, and only then does the modem
//           get "durable", so the drop point can let go of its copy.
// Outbound: the return path. Ops in the log are sent to the drop point one at a
//           time, in order, so phones out there see the community's additions
//           (only ops, never media). The position is saved, so a restart resumes.
//
// The modem protocol is one JSON object per line; see firmware/src/modem/main.cpp.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const RESEND_MS = 120_000; // modem said nothing about the op in flight: offer it again

/**
 * The bridge logic, independent of the serial port (so it can be tested).
 * @param {{ log: {seq:number, op:any}[], appendOps: (ops:any[]) => Promise<void>, validateOp: (op:any) => string|null,
 *           dataDir: string, write: (line: string) => void, now?: () => number, say?: (msg: string) => void }} o
 */
export function createBridge({ log, appendOps, validateOp, dataDir, write, now = Date.now, say = console.log }) {
    const cursorFile = path.join(dataDir, "radio-cursor");
    let cursor = fs.existsSync(cursorFile) ? Number(fs.readFileSync(cursorFile, "utf8")) || 0 : 0;
    let inflight = null; // { seq, id, at }
    let modem = null; // last hello
    const stats = { received: 0, sent: 0, lastSeen: null };

    const send = (obj) => write(JSON.stringify(obj) + "\n");

    function saveCursor() {
        fs.writeFileSync(cursorFile + ".tmp", String(cursor));
        fs.renameSync(cursorFile + ".tmp", cursorFile);
    }

    function hiddenIds() {
        const hidden = new Set();
        for (const e of log) if (e.op.type === "hide") hidden.add(e.op.target);
        return hidden;
    }

    /** Offer the next op to the modem (one in flight at a time). */
    function pump() {
        if (inflight && now() - inflight.at < RESEND_MS) return;
        if (inflight) {
            send({ t: "send", id: inflight.id, op: log.find((e) => e.seq === inflight.seq).op });
            inflight.at = now();
            return;
        }
        const hidden = hiddenIds();
        for (const e of log) {
            if (e.seq <= cursor) continue;
            if (hidden.has(e.op.id)) {
                // moderated away: never send it out; move past it
                cursor = e.seq;
                saveCursor();
                continue;
            }
            inflight = { seq: e.seq, id: e.op.id, at: now() };
            send({ t: "send", id: e.op.id, op: e.op });
            return;
        }
    }

    async function onLine(line) {
        let msg;
        try {
            msg = JSON.parse(line);
        } catch {
            return; // boot noise from the board
        }
        stats.lastSeen = new Date(now()).toISOString();
        switch (msg.t) {
            case "recv": {
                const err = validateOp(msg.op);
                if (err) say(`radio: dropped invalid op (${err})`);
                else {
                    const before = log.length;
                    await appendOps([msg.op]); // durable (fsync) before we say so
                    stats.received += log.length - before; // repeats of a lost "durable" don't count
                }
                send({ t: "durable", m: msg.m });
                break;
            }
            case "sent":
                if (inflight && msg.id === inflight.id) {
                    cursor = inflight.seq;
                    saveCursor();
                    inflight = null;
                    stats.sent++;
                    pump();
                }
                break;
            case "hello":
                modem = msg;
                if (!msg.radio) say("radio: modem reports the radio failed to start");
                break;
            case "log":
                say("modem: " + msg.msg);
                break;
        }
    }

    return {
        onLine,
        pump,
        status: () => ({
            modem: modem ? { radio: modem.radio, rssi: modem.rssi, snr: modem.snr, stats: modem.stats } : "not seen yet",
            receivedFromDropPoint: stats.received,
            sentToDropPoint: stats.sent,
            returnPathCursor: cursor,
            waitingToSend: log.filter((e) => e.seq > cursor).length,
            lastHeardFromModem: stats.lastSeen,
        }),
    };
}

/** Open the modem's serial port (Linux/macOS, no dependencies) and run the bridge. */
export function startRadioBridge({ port, log, appendOps, validateOp, dataDir }) {
    let fd = null;
    let bridge;
    let buf = "";

    const write = (line) => {
        if (fd === null) return;
        try {
            fs.writeSync(fd, line);
        } catch (e) {
            console.log("radio: write failed:", e.message);
            close();
        }
    };

    function close() {
        if (fd !== null) {
            try {
                fs.closeSync(fd);
            } catch {}
        }
        fd = null;
    }

    function open() {
        try {
            const flag = process.platform === "darwin" ? "-f" : "-F";
            execFileSync("stty", [flag, port, "115200", "raw", "-echo", "-echoe", "-echok", "-hupcl"]);
            fd = fs.openSync(port, "r+");
        } catch (e) {
            fd = null;
            return setTimeout(open, 5000);
        }
        console.log(`radio: modem connected on ${port}`);
        const stream = fs.createReadStream(null, { fd, autoClose: false });
        stream.on("data", (chunk) => {
            buf += chunk.toString("utf8");
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, i).trim();
                buf = buf.slice(i + 1);
                if (line) bridge.onLine(line).catch((e) => console.error("radio:", e));
            }
        });
        stream.on("error", () => {
            console.log("radio: modem disconnected; retrying");
            close();
            setTimeout(open, 5000);
        });
        stream.on("end", () => {
            close();
            setTimeout(open, 5000);
        });
        write(JSON.stringify({ t: "ping" }) + "\n");
    }

    bridge = createBridge({ log, appendOps, validateOp, dataDir, write });
    open();
    setInterval(() => fd !== null && bridge.pump(), 2000);
    return bridge;
}
