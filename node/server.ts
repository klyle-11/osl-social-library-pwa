// The node: serves the app and the documents, keeps the shared op log, and
// trades ops with phones. Runs on any laptop (or a Pi) with Node.
//   PORT=8080 node dist-node/server.mjs
// If certs/cert.pem and certs/key.pem exist it serves HTTPS (needed for offline install).
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttps } from "node:https";
import {
    existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, statSync, createReadStream,
    createWriteStream, renameSync, rmSync, openSync, writeSync, fsyncSync
} from "node:fs";
import { createHash, randomBytes, randomInt } from "node:crypto";
import { networkInterfaces } from "node:os";
import { createServer as createNetServer } from "node:net";
import { extname, join, normalize, resolve, sep } from "node:path";
import { validateOp } from "../core/ops";
import { canonical } from "../core/merge";
import { isShareable } from "../core/store";
import { PresenceBoard } from "../core/presence";
import { positionFor } from "../core/cursor";
import { startRadio, type Bridge } from "./radio";
import { DropPointRegister } from "./droppoints";
import type { Op } from "../core/types";

const ROOT = resolve(process.env.OSL_ROOT ?? ".");
const STATIC = join(ROOT, "dist");
const DATA = join(ROOT, "data");
const MEDIA = join(DATA, "media");
const LOG = join(DATA, "ops.jsonl");
const CONFLICTS = join(DATA, "conflicts.jsonl");
const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY = 8 * 1024 * 1024;
const MAX_UPLOAD = Number(process.env.OSL_MAX_UPLOAD ?? 2 * 1024 * 1024 * 1024);
const TOKENS = join(DATA, "tokens.json");
const LOG_ID_FILE = join(DATA, "log-id");
const DEV = process.env.OSL_DEV === "1";

// dev only: the build script tells us when to reload every open page
const reloadClients = new Set<ServerResponse>();
process.on("message", (m: { type?: string }) => {
    if (m?.type !== "reload") return;
    for (const res of reloadClients) res.write("data: reload\n\n");
});

mkdirSync(MEDIA, { recursive: true });

// ---- the op log: append-only file, arrival order; the cursor is a position in it ----
const log: Op[] = [];
const byId = new Map<string, string>();     // id -> canonical form

// A cursor is "<log id>.<position>". The log id is made with the log, so after a clean
// start (data/ deleted) or on another node, a phone's old cursor matches nothing and it
// reads from the beginning, instead of waiting for a position past ops it never got.
const LOG_ID = (existsSync(LOG) && existsSync(LOG_ID_FILE) && readFileSync(LOG_ID_FILE, "utf8").trim()) || newLogId();

function newLogId(): string {
    const id = randomBytes(6).toString("hex");
    writeFileSync(LOG_ID_FILE, id);
    return id;
}

// what a phone sent is every cursor it holds; this node reads its own (core/cursor.ts)
const position = (after: string | null) => positionFor(after ?? "", LOG_ID, log.length);
const NODE = { id: LOG_ID, role: "library" };

const cursorNow = () => `${LOG_ID}.${log.length}`;

if (existsSync(LOG)) {
    // A power cut during a write leaves a last line cut short. It is skipped (and kept in
    // the file), so the node still starts with everything else.
    const text = readFileSync(LOG, "utf8");
    let damaged = 0;
    for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        let parsed: unknown;
        try { parsed = JSON.parse(line); } catch { damaged++; continue; }
        const v = validateOp(parsed);
        if (v.ok && !byId.has(v.op.id)) {
            log.push(v.op);
            byId.set(v.op.id, canonical(v.op));
        }
    }
    // without this the next op would be glued onto the cut line, and lost with it
    if (text.length && !text.endsWith("\n")) appendFileSync(LOG, "\n");
    if (damaged) console.warn(`${damaged} damaged line${damaged === 1 ? "" : "s"} in ${LOG} skipped (left in the file).`);
}

// Held open for appending. Each batch is on disk (fsync) before anyone is told it was
// stored: a drop point deletes its copy when the library says so.
const logFd = openSync(LOG, "a");

function accept(input: unknown[]) {
    let added = 0, duplicates = 0, conflicts = 0;
    const rejected: string[] = [];
    const fresh = new Map<string, { op: Op, key: string }>();
    for (const item of input) {
        const v = validateOp(item);
        if (!v.ok) { rejected.push(v.reason); continue; }
        if (!isShareable(v.op)) { rejected.push("private annotations stay on the phone"); continue; }
        const key = canonical(v.op);
        const existing = byId.get(v.op.id) ?? fresh.get(v.op.id)?.key;
        if (existing === key) { duplicates++; continue; }
        if (existing !== undefined) {
            // same id, different payload: keep the first, record the other, never overwrite
            conflicts++;
            appendFileSync(CONFLICTS, JSON.stringify({ at: new Date().toISOString(), op: v.op }) + "\n");
            continue;
        }
        fresh.set(v.op.id, { op: v.op, key });
        added++;
    }
    if (fresh.size) {
        // on disk first; only then in the log that answers "duplicate" to a retry
        writeSync(logFd, [...fresh.values()].map(f => JSON.stringify(f.op) + "\n").join(""));
        fsyncSync(logFd);
        for (const f of fresh.values()) {
            log.push(f.op);
            byId.set(f.op.id, f.key);
        }
    }
    // `keep` is always empty here: the library takes every valid op (a drop point may not)
    return { added, duplicates, conflicts, rejected, keep: [], cursor: cursorNow(), node: NODE };
}

// ---- the radio (gate seven): RADIO_PORT is the LoRa modem's serial device, e.g. /dev/ttyACM0 ----
const RADIO_POSITION = join(DATA, "radio-position");
const DROP_POINTS = join(DATA, "droppoints.json");
const writeAside = (file: string, text: string) => { writeFileSync(file + ".tmp", text); renameSync(file + ".tmp", file); };

// every drop point this library has heard, from their heartbeats (node/droppoints.ts)
const dropPoints = new DropPointRegister(
    existsSync(DROP_POINTS) ? readFileSync(DROP_POINTS, "utf8") : null,
    json => writeAside(DROP_POINTS, json)
);

const radio: Bridge | null = process.env.RADIO_PORT
    ? startRadio(process.env.RADIO_PORT, {
        log, logId: LOG_ID, accept,
        loadPosition: () => (existsSync(RADIO_POSITION) ? readFileSync(RADIO_POSITION, "utf8").trim() : null),
        savePosition: p => writeAside(RADIO_POSITION, p),
        onStatus: line => { dropPoints.heard(line, new Date()); }
    })
    : null;

// the app version this node serves: a drop point must carry the same (README, W-D10)
function appVersion(): string {
    const sw = join(STATIC, "sw.js");
    return existsSync(sw) ? /osl-shell-([0-9a-f]+)/.exec(readFileSync(sw, "utf8"))?.[1] ?? "dev" : "";
}

// ---- who is here, and what the presenting screen shows: memory only, never the log ----
const board = new PresenceBoard();

// ---- pairing: a code on the node's own screen turns one device into the presenter
// or the digitization station. Presenters can be several; the station is one at a time. ----
const PAIR_CODE = process.env.OSL_CODE ?? String(randomInt(0, 1_000_000)).padStart(6, "0");
type Role = "presenter" | "station";
const tokens: { presenter: string[], station: string | null } = { presenter: [], station: null, ...readTokens() };

// A tokens file that can't be read means devices pair again; the node still starts.
function readTokens(): object {
    if (!existsSync(TOKENS)) return {};
    try { return JSON.parse(readFileSync(TOKENS, "utf8")); }
    catch { console.warn(`${TOKENS} could not be read: paired devices will need to pair again.`); return {}; }
}
const wrongCodes = new Map<string, { count: number, until: number }>();

function pair(role: Role): string {
    const token = randomBytes(24).toString("hex");
    if (role === "station") tokens.station = token;      // pairing a new station unpairs the old one
    else tokens.presenter = [...tokens.presenter.slice(-9), token];
    // written aside, then renamed over the old one, so a power cut never leaves half a file
    writeFileSync(TOKENS + ".tmp", JSON.stringify(tokens));
    renameSync(TOKENS + ".tmp", TOKENS);
    return token;
}

function hasRole(token: unknown, role: Role): boolean {
    if (typeof token !== "string" || !token) return false;
    return role === "station" ? tokens.station === token : tokens.presenter.includes(token);
}

// ---- http ----
const TYPES: Record<string, string> = {
    ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".mjs": "text/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8", ".json": "application/json; charset=utf-8", ".webmanifest": "application/manifest+json",
    ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".gif": "image/gif", ".webp": "image/webp", ".svg": "image/svg+xml",
    ".pdf": "application/pdf", ".txt": "text/plain; charset=utf-8", ".md": "text/plain; charset=utf-8",
    ".mp3": "audio/mpeg", ".m4a": "audio/mp4", ".wav": "audio/wav", ".mp4": "video/mp4", ".webm": "video/webm",
    ".epub": "application/epub+zip"
};

function json(res: ServerResponse, status: number, body: unknown) {
    res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
    res.end(JSON.stringify(body));
}

// A request the client got wrong: answered with its status, not a 500.
class ClientError extends Error {
    status: number;
    constructor(status: number, message: string) { super(message); this.status = status; }
}

// Bodies are always JSON objects; anything else (empty, malformed, null, an
// array) is the client's mistake, so it never reaches a handler.
function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
    return new Promise((ok, fail) => {
        let size = 0;
        const chunks: Buffer[] = [];
        req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_BODY) { fail(new ClientError(413, "too large")); req.destroy(); return; }
            chunks.push(c);
        });
        req.on("end", () => {
            let body: unknown;
            try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
            catch { return fail(new ClientError(400, "expected a JSON body")); }
            if (typeof body !== "object" || body === null || Array.isArray(body)) return fail(new ClientError(400, "expected a JSON object"));
            ok(body as Record<string, unknown>);
        });
        req.on("error", fail);
    });
}

const HASH = /^(sha256-[0-9a-f]{64}|fnv1a-[0-9a-f]{8}-[0-9a-f]+)$/;
const DATA_URL = /^data:([\w/+.-]+);base64,(.*)$/;

// Sends a file, or the part of it the browser asked for. Phones only play (and
// seek in) audio and video when the server answers these Range requests.
function sendFile(req: IncomingMessage, res: ServerResponse, file: string, type: string, extraHeaders: Record<string, string> = {}) {
    const size = statSync(file).size;
    const headers: Record<string, string | number> = { "content-type": type, "accept-ranges": "bytes", ...extraHeaders };
    const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range ?? "");
    if (range && (range[1] || range[2])) {
        // "bytes=500-" from 500 to the end; "bytes=-500" the last 500; "bytes=0-99" the first 100
        const start = range[1] ? Number(range[1]) : Math.max(0, size - Number(range[2]));
        const end = range[1] && range[2] ? Math.min(Number(range[2]), size - 1) : size - 1;
        if (start >= size || start > end) {
            res.writeHead(416, { "content-range": `bytes */${size}` });
            res.end();
            return;
        }
        res.writeHead(206, { ...headers, "content-range": `bytes ${start}-${end}/${size}`, "content-length": end - start + 1 });
        if (req.method === "HEAD") { res.end(); return; }
        createReadStream(file, { start, end }).pipe(res);
        return;
    }
    res.writeHead(200, { ...headers, "content-length": size });
    if (req.method === "HEAD") { res.end(); return; }
    createReadStream(file).pipe(res);
}

function serveFile(req: IncomingMessage, res: ServerResponse, file: string, extraHeaders: Record<string, string> = {}) {
    sendFile(req, res, file, TYPES[extname(file).toLowerCase()] ?? "application/octet-stream", extraHeaders);
}

const UPLOADABLE = /^(audio|video|image)\/[\w.+-]+$|^application\/(pdf|epub\+zip)$|^text\/plain$/;

// The digitization station sends whole files (scans, audio, video). The bytes go
// straight to disk and are hashed on the way past, so a large film never sits in memory.
function receiveUpload(req: IncomingMessage, type: string): Promise<{ hash: string, size: number }> {
    return new Promise((ok, fail) => {
        const temp = join(MEDIA, `.upload-${randomBytes(6).toString("hex")}`);
        const out = createWriteStream(temp);
        const digest = createHash("sha256");
        let size = 0;
        const abandon = (e: Error) => { out.destroy(); rmSync(temp, { force: true }); fail(e); };
        req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX_UPLOAD) { req.destroy(); abandon(new Error("file is too large for this node")); return; }
            digest.update(c);
        });
        req.on("error", abandon);
        req.on("aborted", () => abandon(new Error("upload was interrupted")));
        out.on("error", abandon);
        out.on("finish", () => {
            if (!size) return abandon(new Error("empty file"));
            const hash = "sha256-" + digest.digest("hex");
            renameSync(temp, join(MEDIA, hash));     // same bytes, same name: uploading twice is harmless
            writeFileSync(join(MEDIA, hash + ".type"), type);
            ok({ hash, size });
        });
        req.pipe(out);
    });
}

function localAddresses(): string[] {
    const found: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
        for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) found.push(a.address);
    }
    return found;
}

async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://node");
    const path = decodeURIComponent(url.pathname);

    if (DEV && path === "/api/dev/reload") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(": connected\n\n");
        reloadClients.add(res);
        req.on("close", () => reloadClients.delete(res));
        return;
    }

    if (path === "/api/health") {
        return json(res, 200, { ok: true, ops: log.length, online: board.snapshot(Date.now()).online.length });
    }

    // what a joining phone needs to be told: the addresses this node answers on
    // the library and every drop point it has heard: for the Drop points page
    if (path === "/api/droppoints" && req.method === "GET") {
        const version = appVersion();
        const modem = radio?.status() ?? null;
        return json(res, 200, {
            library: {
                app: version,
                phones: board.snapshot(Date.now()).online.length,
                radio: modem && {
                    port: process.env.RADIO_PORT,
                    // the modem says hello every 30 s
                    connected: !!modem.lastHeardFromModem && Date.now() - Date.parse(modem.lastHeardFromModem) < 90_000,
                    working: modem.modem?.radio ?? null,
                    lastHeard: modem.lastHeardFromModem,
                    waitingToSend: modem.waitingToSend
                }
            },
            droppoints: dropPoints.list(new Date(), version)
        });
    }

    // a paired presenter takes a drop point off the list (it reappears if it is heard again)
    if (path === "/api/droppoints/forget" && req.method === "POST") {
        const body = await readBody(req);
        if (!hasRole(body.token, "presenter")) return json(res, 403, { error: "Only a paired presenter can change the list." });
        return json(res, dropPoints.forget(String(body.id ?? "")) ? 200 : 404, {});
    }

    if (path === "/api/radio" && req.method === "GET") {
        return json(res, 200, radio ? radio.status() : { radio: "off", how: "start the node with RADIO_PORT set to the modem's serial device" });
    }

    if (path === "/api/info") {
        const scheme = secure ? "https" : "http";
        return json(res, 200, {
            secure,
            addresses: localAddresses().map(a => `${scheme}://${a}:${PORT}`),
            host: req.headers.host ?? ""
        });
    }

    // The one request every device repeats: "what's new since my cursor?" It also
    // says who is asking and what they have open, which is all presence needs.
    if (path === "/api/ops" && req.method === "GET") {
        const after = position(url.searchParams.get("after"));
        const user = (url.searchParams.get("user") ?? "").slice(0, 64);
        if (user) board.hello(user, (url.searchParams.get("viewing") ?? "").slice(0, 200), Date.now());
        return json(res, 200, { ops: log.slice(after), cursor: cursorNow(), presence: board.snapshot(Date.now()), node: NODE });
    }

    if (path === "/api/pair" && req.method === "POST") {
        const body = await readBody(req) as { code?: unknown, role?: unknown };
        const who = req.socket.remoteAddress ?? "?";
        const strikes = wrongCodes.get(who);
        if (strikes && strikes.count >= 5 && strikes.until > Date.now()) {
            return json(res, 429, { error: "Too many wrong codes. Wait a minute and try again." });
        }
        if (body.role !== "presenter" && body.role !== "station") return json(res, 400, { error: "role must be presenter or station" });
        if (body.code !== PAIR_CODE) {
            wrongCodes.set(who, { count: (strikes?.count ?? 0) + 1, until: Date.now() + 60_000 });
            return json(res, 403, { error: "That isn't the code on the library's screen." });
        }
        wrongCodes.delete(who);
        console.log(`paired a ${body.role}`);
        return json(res, 200, { role: body.role, token: pair(body.role) });
    }

    if (path === "/api/showing" && req.method === "POST") {
        const body = await readBody(req) as { token?: unknown, documentId?: unknown, user?: unknown };
        if (!hasRole(body.token, "presenter")) return json(res, 403, { error: "This device isn't paired as a presenter." });
        if (body.documentId === null || body.documentId === "") board.showing = null;
        else if (typeof body.documentId === "string" && body.documentId.length <= 200) {
            board.showing = { documentId: body.documentId, by: String(body.user ?? "").slice(0, 64), since: new Date().toISOString() };
        } else return json(res, 400, { error: "expected { documentId }" });
        return json(res, 200, { showing: board.showing });
    }

    if (path === "/api/upload" && req.method === "POST") {
        if (!hasRole(req.headers["x-osl-token"], "station")) {
            req.resume();
            return json(res, 403, { error: "This computer isn't paired as the digitization station." });
        }
        const type = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        if (!UPLOADABLE.test(type)) { req.resume(); return json(res, 415, { error: `The library doesn't take ${type || "that kind of"} files.` }); }
        if (Number(req.headers["content-length"] ?? 0) > MAX_UPLOAD) { req.resume(); return json(res, 413, { error: "file is too large for this node" }); }
        const saved = await receiveUpload(req, type);
        console.log(`station uploaded ${saved.hash.slice(0, 15)}… (${saved.size} bytes, ${type})`);
        return json(res, 200, { ...saved, fileType: type });
    }

    if (path === "/api/ops" && req.method === "POST") {
        const body = await readBody(req) as { ops?: unknown };
        if (!Array.isArray(body.ops)) return json(res, 400, { error: "expected { ops: [...] }" });
        const result = accept(body.ops);
        if (result.added) console.log(`+${result.added} ops (total ${log.length})`);
        return json(res, 200, result);
    }

    if (path === "/api/media" && req.method === "POST") {
        const body = await readBody(req) as { hash?: unknown, data?: unknown };
        if (typeof body.hash !== "string" || !HASH.test(body.hash) || typeof body.data !== "string") {
            return json(res, 400, { error: "expected { hash, data }" });
        }
        const m = DATA_URL.exec(body.data);
        if (!m) return json(res, 400, { error: "data must be a base64 data URL" });
        writeFileSync(join(MEDIA, body.hash), Buffer.from(m[2], "base64"));
        writeFileSync(join(MEDIA, body.hash + ".type"), m[1]);
        return json(res, 200, { ok: true });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" });

    if (path === "/ca.pem") return serveCa(res);

    // media people uploaded from their phones
    if (path.startsWith("/media/")) {
        const hash = path.slice("/media/".length);
        const file = join(MEDIA, hash);
        if (!HASH.test(hash) || !existsSync(file)) return json(res, 404, { error: "not found" });
        const type = existsSync(file + ".type") ? readFileSync(file + ".type", "utf8") : "application/octet-stream";
        sendFile(req, res, file, type, { "cache-control": "public, max-age=31536000, immutable" });
        return;
    }

    // the built app and the library files
    const rel = normalize(path === "/" ? "/index.html" : path).replace(/^([/\\])+/, "");
    const file = join(STATIC, rel);
    if (!file.startsWith(STATIC + sep) || !existsSync(file) || !statSync(file).isFile()) {
        return json(res, 404, { error: "not found" });
    }
    const noCache = rel === "sw.js" || rel === "index.html" || rel === "catalog.json" || rel === "app.js" || rel === "styles.css";
    serveFile(req, res, file, noCache ? { "cache-control": "no-cache" } : {});
}

function onRequest(req: IncomingMessage, res: ServerResponse) {
    handle(req, res).catch(e => {
        if (e instanceof ClientError) { if (!res.headersSent) json(res, e.status, { error: e.message }); return; }
        console.error(e);
        if (!res.headersSent) json(res, 500, { error: String(e instanceof Error ? e.message : e) });
    });
}

const caFile = join(ROOT, "certs", "rootCA.pem");

// phones download this once to trust the node's certificate (see scripts/cert.mjs)
function serveCa(res: ServerResponse) {
    if (!existsSync(caFile)) return json(res, 404, { error: "no CA here — run npm run cert" });
    res.writeHead(200, {
        "content-type": "application/x-x509-ca-cert",
        "content-disposition": "attachment; filename=\"osl-node-ca.pem\""
    });
    createReadStream(caFile).pipe(res);
}

const certFile = join(ROOT, "certs", "cert.pem");
const keyFile = join(ROOT, "certs", "key.pem");
const secure = existsSync(certFile) && existsSync(keyFile);
const server = secure
    ? createHttps({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, onRequest)
    : createHttp(onRequest);

// In https mode, PORT+1 hands out the CA so phones can trust the node. iOS Safari
// tries https first even when you type http://, so this port answers both: the
// first byte of a TLS handshake is 0x16, anything else is plain http.
if (secure) {
    const helper = (req: IncomingMessage, res: ServerResponse) => {
        if (req.url === "/ca.pem") return serveCa(res);
        const host = (req.headers.host ?? "localhost").replace(/:\d+$/, "");
        res.writeHead(302, { location: `https://${host}:${PORT}${req.url ?? "/"}` });
        res.end();
    };
    const plain = createHttp(helper);
    const tls = createHttps({ cert: readFileSync(certFile), key: readFileSync(keyFile) }, helper);
    createNetServer(socket => {
        socket.once("data", first => {
            socket.pause();
            socket.unshift(first);
            (first[0] === 0x16 ? tls : plain).emit("connection", socket);
            socket.resume();
        });
        socket.on("error", () => socket.destroy());
    }).listen(PORT + 1, "0.0.0.0");
}

server.listen(PORT, "0.0.0.0", () => {
    const scheme = secure ? "https" : "http";
    // the version a drop point must match (npm run build:firmware prints its own)
    const version = appVersion() || "?";
    console.log(`\nOSL node running — ${log.length} ops in the log, app version ${version}${radio ? `, radio on ${process.env.RADIO_PORT}` : ""}\n`);
    console.log(`  this laptop:  ${scheme}://localhost:${PORT}`);
    for (const a of localAddresses()) console.log(`  phones:       ${scheme}://${a}:${PORT}`);
    console.log(`  big screen:   ${scheme}://localhost:${PORT}/#/present`);
    console.log(`\n  Pairing code: ${PAIR_CODE}   (You → Pair this device, to present or to upload)`);
    if (secure) {
        console.log(`\n  Phones trust it once: AirDrop certs/rootCA.pem to the phone, or open http://<address>:${PORT + 1}/ca.pem`);
        console.log("  then iPhone: Settings → Profile Downloaded → Install, and General → About → Certificate Trust Settings → on.");
    } else {
        console.log("\n  Plain http: phones can use it live on this Wi-Fi, but can't install it for offline use.");
        console.log("  For offline take-home, add certs/cert.pem + certs/key.pem (see README → Where the domain comes in).");
    }
    console.log("");
});
