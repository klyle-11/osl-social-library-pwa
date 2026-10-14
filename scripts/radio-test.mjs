// Bench test for the radio link: two boards flashed with the MODEM firmware,
// both plugged into this computer by USB. Sends small test ops each way and
// reports what arrived, how long it took, and the signal strength.
//
//   node scripts/radio-test.mjs /dev/cu.usbmodemA /dev/cu.usbmodemB [count]
//
// macOS ports look like /dev/cu.usbmodem1101; on the Pi, /dev/ttyACM0 and /dev/ttyACM1.
// No app is involved: this only proves the boards, antennas and settings work.
import fs from "node:fs";
import { execFileSync } from "node:child_process";

const [portA, portB, countArg] = process.argv.slice(2);
if (!portA || !portB) {
    console.error("usage: node scripts/radio-test.mjs <port A> <port B> [how many each way, default 5]");
    process.exit(1);
}
const COUNT = Number(countArg ?? 5);
const TIMEOUT_MS = 90_000;

function open(name, port) {
    // raw 115200, and don't reset the board when the port closes
    execFileSync("stty", [process.platform === "darwin" ? "-f" : "-F", port, "115200", "raw", "-echo", "-echoe", "-echok", "-hupcl"]);
    const fd = fs.openSync(port, "r+");
    const board = { name, radio: null, rssi: null, snr: null, onRecv: null, onSent: null };
    let buf = "";
    fs.createReadStream(null, { fd, autoClose: false }).on("data", chunk => {
        buf += chunk.toString("utf8");
        let i;
        while ((i = buf.indexOf("\n")) >= 0) {
            const line = buf.slice(0, i).trim();
            buf = buf.slice(i + 1);
            if (!line.startsWith("{")) continue;
            let m;
            try { m = JSON.parse(line); } catch { continue; }
            if (m.t === "hello") { board.radio = m.radio; board.rssi = m.rssi; board.snr = m.snr; board.error = m.radioError; }
            if (m.t === "log") console.log(`  [${name}] ${m.msg}`);
            if (m.t === "recv") {
                // what the Pi would do: store it, then say so, which lets the sender let go
                board.send({ t: "durable", m: m.m });
                board.onRecv?.(m.op);
            }
            if (m.t === "sent") board.onSent?.(m.id);
        }
    });
    board.send = obj => fs.writeSync(fd, JSON.stringify(obj) + "\n");
    return board;
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function ready(board) {
    for (let i = 0; i < 20 && board.radio === null; i++) { board.send({ t: "ping" }); await sleep(500); }
    if (board.radio === null) throw new Error(`${board.name}: no answer. Is it flashed with a modem build, and is this the right port?`);
    if (!board.radio) throw new Error(`${board.name}: the radio did not start (error ${board.error}). Check the board chosen in platformio.ini and the antenna.`);
    console.log(`${board.name}: radio started`);
}

async function run(from, to, n) {
    let delivered = 0, confirmed = 0;
    const times = [];
    for (let i = 1; i <= n; i++) {
        const id = `test-${from.name}:${i}`;
        const op = { id, type: "annotation", user: `test-${from.name}`, target: "steward:1", body: `radio test ${i} from ${from.name}`, access: "public", timestamp: new Date().toISOString().replace(/\.\d+Z$/, "Z") };
        const started = Date.now();
        const arrived = new Promise(r => { to.onRecv = got => { if (got.id === id) r(true); }; });
        const acked = new Promise(r => { from.onSent = got => { if (got === id) r(true); }; });
        from.send({ t: "send", id, op });
        const timeout = sleep(TIMEOUT_MS).then(() => false);
        if (await Promise.race([arrived, timeout])) { delivered++; times.push(Date.now() - started); }
        if (await Promise.race([acked, timeout])) confirmed++;
        process.stdout.write(delivered === i && confirmed === i ? "." : "x");
    }
    to.send({ t: "ping" });
    await sleep(700);
    const avg = times.length ? Math.round(times.reduce((a, b) => a + b, 0) / times.length) : null;
    console.log(`\n${from.name} -> ${to.name}: ${delivered}/${n} arrived, ${confirmed}/${n} confirmed back` +
        (avg !== null ? `, about ${avg} ms each` : "") + `, signal at ${to.name}: RSSI ${to.rssi} dBm, SNR ${to.snr} dB`);
    return delivered === n && confirmed === n;
}

const a = open("A", portA), b = open("B", portB);
try {
    await ready(a); await ready(b);
    const ok = (await run(a, b, COUNT)) & (await run(b, a, COUNT));
    console.log(ok ? "\nPASS: the link works both ways." : "\nFAIL: some messages did not make it. Move the boards 2+ metres apart, check both antennas, and try again.");
    process.exit(ok ? 0 : 1);
} catch (e) {
    console.error("\n" + e.message);
    process.exit(1);
}
