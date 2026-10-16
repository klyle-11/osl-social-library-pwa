// The node: serves the app and the documents, keeps the shared op log, and
// trades ops with phones. Runs on any laptop (or a Pi) with Node.
//   PORT=8080 node dist-node/server.mjs
// If certs/cert.pem and certs/key.pem exist it serves HTTPS (needed for offline install).
import { createServer as createHttp, type IncomingMessage, type ServerResponse } from "node:http";
import { createServer as createHttps } from "node:https";
import {
    existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync, statSync, createReadStream,
    createWriteStream, renameSync, rmSync, openSync, readSync, closeSync
} from "node:fs";
import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { hostname, networkInterfaces } from "node:os";
import { createServer as createNetServer } from "node:net";
import { extname, isAbsolute, join, normalize, resolve, sep } from "node:path";
import { startRadio, type Bridge, type RadioLibrary } from "./radio";
import { DropPointRegister } from "./droppoints";
import { exportEntries, sendZip } from "./export";
import { writeAside } from "./files";
import { Accounts, MIN_PASSWORD, Sessions } from "./accounts";
import { Libraries, MAIN } from "./libraries";
import { verifyPassword } from "./passwords";
import { startWatching } from "./watch";
import {
    NOT_PAIRED, cleanRoles, cleanUploaders, mayAdminister, mayOpen, mayPresent, mayUpload, rolesOf, stewardsOf,
    type Account, type LibraryConfig, type Paired, type Session
} from "./policy";
import type { Identity, Op } from "../core/types";

const ROOT = resolve(process.env.OSL_ROOT ?? ".");
const STATIC = join(ROOT, "dist");
const DATA = join(ROOT, "data");
const MEDIA = join(DATA, "media");
const PORT = Number(process.env.PORT ?? 8080);
const MAX_BODY = 8 * 1024 * 1024;
const MAX_UPLOAD = Number(process.env.OSL_MAX_UPLOAD ?? 2 * 1024 * 1024 * 1024);
const TOKENS = join(DATA, "tokens.json");
// Suggestions and user-testing notes: for the developer only. They never enter the op
// log (which every phone gets), so nothing on the site shows them; this file and the
// Suggestions page, which asks for the key below, are the only ways to read them.
const SUGGESTIONS = join(DATA, "suggestions.jsonl");
const SUGGESTIONS_KEY_FILE = join(DATA, "suggestions-key");
const SUGGESTIONS_MAX_FILE = 20 * 1024 * 1024;
const SUGGESTION_KINDS = ["broken", "confusing", "idea", "testing", "other"];
const DEV = process.env.OSL_DEV === "1";

// dev only: the build script tells us when to reload every open page
const reloadClients = new Set<ServerResponse>();
process.on("message", (m: { type?: string }) => {
    if (m?.type !== "reload") return;
    for (const res of reloadClients) res.write("data: reload\n\n");
});

mkdirSync(MEDIA, { recursive: true });

// ---- libraries (each with its own op log), accounts and sessions: W-D12 ----
const libraries = new Libraries(DATA, process.env.OSL_NAME ?? "Library");
const accounts = new Accounts(join(DATA, "accounts.json"), () => libraries.bump());
const sessions = new Sessions(join(DATA, "sessions.json"));
const main = libraries.log(MAIN);
// files put in a library's folder on the node become its documents
const watcher = startWatching({ libraries, media: MEDIA, maxBytes: MAX_UPLOAD });

// who is who, for the node's own decisions: every signed-in device, and this library's groups
function identityOf(lib: LibraryConfig): Identity {
    return { devices: accounts.devices(), groups: Object.fromEntries(lib.groups.map(g => [g.id, g.members])) };
}

// may a document op from this device be taken? Over the radio there is no session: only accounts count.
function documentRule(lib: LibraryConfig, paired: Paired) {
    return (op: Op) => op.type === "document" && !mayUpload(lib, accounts.get(accounts.ownerOf(op.user)), paired)
        ? "Adding documents to this library isn't open to everyone." : null;
}

// ---- the radio (gate seven): RADIO_PORT is the LoRa modem's serial device, e.g. /dev/ttyACM0 ----
const RADIO_POSITION = join(DATA, "radio-position");
const DROP_POINTS = join(DATA, "droppoints.json");

// every drop point this library has heard, from their heartbeats (node/droppoints.ts)
const dropPoints = new DropPointRegister(
    existsSync(DROP_POINTS) ? readFileSync(DROP_POINTS, "utf8") : null,
    json => writeAside(DROP_POINTS, json)
);

// The libraries drop points carry: the main one, and any other the node admin lets go
// out (W-D12: their ops and password hashes sit in the boards' flash).
function carried(): RadioLibrary[] {
    return libraries.list().filter(l => l.id === MAIN || l.droppoints).map(lib => {
        const log = libraries.log(lib.id);
        return {
            id: lib.id, name: lib.name, hash: lib.password, log: log.log, logId: log.logId,
            accept: (ops: unknown[]) => log.accept(ops, documentRule(lib, NOT_PAIRED)),
            skip: log.notFor(null, identityOf(lib))
        };
    });
}

const radio: Bridge | null = process.env.RADIO_PORT
    ? startRadio(process.env.RADIO_PORT, {
        libraries: carried,
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
    ".epub": "application/epub+zip", ".wasm": "application/wasm", ".bcmap": "application/octet-stream", ".pfb": "application/octet-stream"
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

// Anyone can upload any kind of file. A type only has to be well formed: it's
// stored next to the file and sent back as its content-type.
const MIME = /^[a-z0-9][\w.+-]*\/[\w.+-]+$/;
// The types that open in the browser. Everything else is served as a download.
// SVG isn't here: it can carry scripts.
const INLINE = /^(audio|video)\/|^image\/(jpeg|png|gif|webp|avif|heic|heif|bmp)$|^application\/(pdf|epub\+zip)$|^text\/plain$/;
// the reader opens these, so they must be what they say: a PDF's header may sit
// a little way in, an EPUB is a zip
const LOOKS: Record<string, (head: Buffer) => boolean> = {
    "application/pdf": head => head.includes("%PDF-"),
    "application/epub+zip": head => head.subarray(0, 4).equals(Buffer.from("PK\x03\x04", "latin1"))
};

// Whole files, from anyone: the digitization station's scans and films, and whatever
// people bring. The bytes go straight to disk and are hashed on the way past, so a
// large film never sits in memory.
function receiveUpload(req: IncomingMessage, type: string, limit = MAX_UPLOAD, looksRight?: (head: Buffer) => boolean): Promise<{ hash: string, size: number }> {
    return new Promise((ok, fail) => {
        const temp = join(MEDIA, `.upload-${randomBytes(6).toString("hex")}`);
        const out = createWriteStream(temp);
        const digest = createHash("sha256");
        let size = 0;
        const abandon = (e: Error) => { out.destroy(); rmSync(temp, { force: true }); fail(e); };
        req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > limit) { req.destroy(); abandon(new ClientError(413, tooLarge(limit))); return; }
            digest.update(c);
        });
        req.on("error", abandon);
        req.on("aborted", () => abandon(new Error("upload was interrupted")));
        out.on("error", abandon);
        out.on("finish", () => {
            if (!size) return abandon(new ClientError(400, "empty file"));
            if (looksRight && !looksRight(readHead(temp))) return abandon(new ClientError(415, `That file isn't a ${type === "application/pdf" ? "PDF" : "EPUB"} inside.`));
            const hash = "sha256-" + digest.digest("hex");
            renameSync(temp, join(MEDIA, hash));     // same bytes, same name: uploading twice is harmless
            writeFileSync(join(MEDIA, hash + ".type"), type);
            ok({ hash, size });
        });
        req.pipe(out);
    });
}

function readHead(file: string): Buffer {
    const fd = openSync(file, "r");
    try {
        const head = Buffer.alloc(1024);
        return head.subarray(0, readSync(fd, head, 0, head.length, 0));
    } finally {
        closeSync(fd);
    }
}

function tooLarge(limit: number): string {
    return `That file is too large for this library (the most it takes is ${Math.round(limit / 1024 / 1024)} MB).`;
}

// The address to give people: the machine's own name on the network (a Pi named
// "osl" is osl.local, which phones find without DNS), then its IP addresses.
// The port is left off when it's the scheme's own.
function joinAddresses(scheme: string): string[] {
    const port = PORT === (scheme === "https" ? 443 : 80) ? "" : `:${PORT}`;
    const name = hostname().split(".")[0].toLowerCase();
    const named = /^[a-z0-9-]+$/.test(name) && name !== "localhost" ? [`${scheme}://${name}.local${port}`] : [];
    return [...named, ...localAddresses().map(a => `${scheme}://${a}${port}`)];
}

// made once, kept in data/: the developer's key to the suggestions page
function suggestionsKey(): string {
    if (!existsSync(SUGGESTIONS_KEY_FILE)) writeFileSync(SUGGESTIONS_KEY_FILE, randomBytes(12).toString("base64url"), { mode: 0o600 });
    return readFileSync(SUGGESTIONS_KEY_FILE, "utf8").trim();
}

function localAddresses(): string[] {
    const found: string[] = [];
    for (const list of Object.values(networkInterfaces())) {
        for (const a of list ?? []) if (a.family === "IPv4" && !a.internal) found.push(a.address);
    }
    return found;
}

// ---- who is asking: their session (a cookie), its account, and any pairing token ----
type Who = { session: Session | null, account: Account | null, paired: Paired };

// `token`: the pairing tokens a device holds, comma-separated (x-osl-token)
function whoIs(req: IncomingMessage, token: unknown = req.headers["x-osl-token"]): Who {
    const session = sessions.read(req);
    const account = accounts.get(session?.account);
    const held = typeof token === "string" ? token.split(",").slice(0, 4).map(t => t.trim()) : [];
    return {
        session,
        account: account && !account.disabled ? account : null,
        paired: { presenter: held.some(t => hasRole(t, "presenter")), station: held.some(t => hasRole(t, "station")) }
    };
}

// `?library=<id>`; without it, the main library (so drop points and older apps keep working)
function libraryFor(url: URL): LibraryConfig | null {
    return libraries.get(url.searchParams.get("library") || MAIN);
}

function locked(res: ServerResponse, lib: LibraryConfig) {
    return json(res, 401, { error: "This library is protected. Enter its password, or sign in.", locked: true, library: { id: lib.id, name: lib.name } });
}

// Too many wrong passwords or codes from one address: wait a minute.
const strikes = new Map<string, { count: number, until: number }>();
function struckOut(key: string): boolean {
    const s = strikes.get(key);
    if (s && s.until < Date.now()) strikes.delete(key);
    return !!s && s.count >= 5 && s.until > Date.now();
}
function strike(key: string) {
    const s = strikes.get(key);
    strikes.set(key, { count: (s?.count ?? 0) + 1, until: Date.now() + 60_000 });
    if (strikes.size > 10_000) strikes.clear();   // a flood of addresses can't fill the memory
}

// the main library's catalog (library/documents.json, built into dist/): read when it changes
let catalogCache: { at: number, stewards: string[], ops: Op[] } = { at: -1, stewards: [], ops: [] };
function catalog() {
    const file = join(STATIC, "catalog.json");
    const at = existsSync(file) ? statSync(file).mtimeMs : 0;
    if (at !== catalogCache.at) {
        try {
            const c = at ? JSON.parse(readFileSync(file, "utf8")) as { stewards?: string[], ops?: Op[] } : {};
            catalogCache = { at, stewards: c.stewards ?? [], ops: c.ops ?? [] };
        } catch {
            catalogCache = { at, stewards: [], ops: [] };
        }
    }
    return catalogCache;
}

// Everything the app needs to know about people here: the "directory" (W-D12). A library
// this browser may not open says only its name.
function directory(lib: LibraryConfig, w: Who) {
    const base = {
        revision: libraries.revision,
        libraries: libraries.list().map(l => ({ id: l.id, name: l.name, protected: !!l.password, open: mayOpen(l, w.account, w.session) })),
        me: w.account && { id: w.account.id, username: w.account.username, name: w.account.name, admin: w.account.admin },
        signup: accounts.signup,
        setup: accounts.count === 0          // no accounts yet: the first needs the pairing code
    };
    if (!mayOpen(lib, w.account, w.session)) return { ...base, library: { id: lib.id, name: lib.name, protected: true, locked: true } };
    const log = libraries.log(lib.id);
    // the accounts anyone here could meet: who wrote here, who has a role here, the node admins, me
    const relevant = new Set<string>(Object.keys(lib.roles));
    for (const d of log.authors) { const a = accounts.ownerOf(d); if (a) relevant.add(a); }
    for (const g of lib.groups) for (const m of g.members) relevant.add(m);
    if (w.account) relevant.add(w.account.id);
    const people = accounts.list().filter(a => relevant.has(a.id) || a.admin);
    const roles = rolesOf(lib, w.account);
    const admin = roles.has("admin");
    return {
        ...base,
        library: {
            id: lib.id, name: lib.name, protected: !!lib.password, locked: false,
            upload: lib.upload, mayUpload: mayUpload(lib, w.account, w.paired), roles: [...roles],
            ...(w.account?.admin && { watch: lib.watch, droppoints: lib.id === MAIN || lib.droppoints })
        },
        accounts: Object.fromEntries(people.map(a => [a.id, a.name])),
        devices: Object.fromEntries(people.flatMap(a => a.devices.map(d => [d, a.id]))),
        groups: lib.groups,
        stewards: [...(lib.id === MAIN ? catalog().stewards : []), ...stewardsOf(lib, accounts.list())],
        // who holds which role: for the people who hand them out
        ...(admin && { roles: lib.roles })
    };
}

// May this device's op be taken from this browser? A signed-in device's ops wait on the
// phone until its account is signed in again. Then the library's rule for documents.
function authorRule(lib: LibraryConfig, w: Who) {
    const documents = documentRule(lib, w.paired);
    return (op: Op) => {
        const owner = accounts.ownerOf(op.user);
        if (owner && owner !== w.account?.id) return { keep: "signed out" };
        return documents(op);
    };
}

const str = (v: unknown, max = 200) => (typeof v === "string" ? v.slice(0, max) : "");

async function handle(req: IncomingMessage, res: ServerResponse) {
    const url = new URL(req.url ?? "/", "http://node");
    let path = decodeURIComponent(url.pathname);
    // Another library's API is under /api/l/<id>/ (the same as ?library=<id>). A drop point
    // that carries only the main library doesn't know these paths and says 404, so a phone
    // in another library never hands its notes to the wrong one there.
    const scoped = /^\/api\/l\/([a-z0-9-]{1,32})(\/.*)$/.exec(path);
    if (scoped) {
        url.searchParams.set("library", scoped[1]);
        path = "/api" + scoped[2];
    }
    const ip = req.socket.remoteAddress ?? "?";

    if (DEV && path === "/api/dev/reload") {
        res.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-store", connection: "keep-alive" });
        res.write(": connected\n\n");
        reloadClients.add(res);
        req.on("close", () => reloadClients.delete(res));
        return;
    }

    // A page on another site can't act with someone's session here: the cookie is SameSite,
    // and a request that says it comes from elsewhere is turned away.
    if (req.method === "POST" && req.headers.origin) {
        let host = "";
        try { host = new URL(req.headers.origin).host; } catch { /* "null": a sandboxed page */ }
        if (host !== req.headers.host) return json(res, 403, { error: "That request came from another site." });
    }

    if (path === "/api/health") {
        return json(res, 200, { ok: true, ops: main.log.length, online: main.board.snapshot(Date.now()).online.length, libraries: libraries.list().length });
    }

    // the library and every drop point it has heard: for the Drop points page
    if (path === "/api/droppoints" && req.method === "GET") {
        const version = appVersion();
        const modem = radio?.status() ?? null;
        const now = Date.now();
        return json(res, 200, {
            library: {
                app: version,
                phones: libraries.list().reduce((n, l) => n + libraries.log(l.id).board.snapshot(now).online.length, 0),
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

    // a paired presenter (or a node admin) takes a drop point off the list (it reappears if it is heard again)
    if (path === "/api/droppoints/forget" && req.method === "POST") {
        const body = await readBody(req);
        if (!hasRole(body.token, "presenter") && !whoIs(req).account?.admin) return json(res, 403, { error: "Only a paired presenter can change the list." });
        return json(res, dropPoints.forget(String(body.id ?? "")) ? 200 : 404, {});
    }

    if (path === "/api/radio" && req.method === "GET") {
        return json(res, 200, radio ? radio.status() : { radio: "off", how: "start the node with RADIO_PORT set to the modem's serial device" });
    }

    if (path === "/api/info") {
        const scheme = secure ? "https" : "http";
        return json(res, 200, {
            secure,
            addresses: joinAddresses(scheme),
            host: req.headers.host ?? ""
        });
    }

    // ---- accounts: optional, one per node (W-D12) ----

    if (path === "/api/account/signup" && req.method === "POST") {
        const body = await readBody(req);
        const first = accounts.count === 0;
        if (first) {
            // the first account is the node admin: it takes the code on the node's own screen
            if (struckOut("code:" + ip)) return json(res, 429, { error: "Too many wrong codes. Wait a minute and try again." });
            if (body.code !== PAIR_CODE) { strike("code:" + ip); return json(res, 403, { error: "The first account looks after this node, so it needs the code on the library's screen." }); }
        } else if (!accounts.signup && !whoIs(req).account?.admin) {
            return json(res, 403, { error: "Accounts here are made by the node admin." });
        }
        const made = await accounts.create({ username: str(body.username, 64), name: str(body.name, 80), password: str(body.password, 1000) });
        if (typeof made === "string") return json(res, 400, { error: made });
        console.log(`account made: ${made.username}${made.admin ? " (node admin)" : ""}`);
        // an admin making an account for someone else stays signed in as themselves
        if (!first && whoIs(req).account?.admin && body.signIn === false) return json(res, 200, { account: made.id });
        const session = sessions.ensure(req, res, secure);
        session.account = made.id;
        sessions.changed();
        const device = str(body.device, 64);
        return json(res, 200, { account: made.id, linked: device ? accounts.link(made.id, device) : null });
    }

    if (path === "/api/account/signin" && req.method === "POST") {
        const body = await readBody(req);
        if (struckOut("signin:" + ip)) return json(res, 429, { error: "Too many wrong tries. Wait a minute and try again." });
        const account = await accounts.check(str(body.username, 64), str(body.password, 1000));
        if (!account) { strike("signin:" + ip); return json(res, 403, { error: "That username and password don't match." }); }
        const session = sessions.ensure(req, res, secure);
        session.account = account.id;
        sessions.changed();
        const device = str(body.device, 64);
        return json(res, 200, { account: account.id, linked: device ? accounts.link(account.id, device) : null });
    }

    // this (new) device writes for the signed-in account from now on
    if (path === "/api/account/link" && req.method === "POST") {
        const body = await readBody(req);
        const w = whoIs(req);
        if (!w.account) return json(res, 401, { error: "Sign in first." });
        const device = str(body.device, 64);
        if (!device) return json(res, 400, { error: "expected { device }" });
        return json(res, 200, { linked: accounts.link(w.account.id, device) });
    }

    if (path === "/api/account/signout" && req.method === "POST") {
        const session = sessions.read(req);
        if (session) { session.account = null; sessions.changed(); }
        return json(res, 200, { ok: true });
    }

    if (path === "/api/account/update" && req.method === "POST") {
        const body = await readBody(req);
        const w = whoIs(req);
        if (!w.account) return json(res, 401, { error: "Sign in first." });
        if (typeof body.password === "string") {
            if (struckOut("signin:" + ip)) return json(res, 429, { error: "Too many wrong tries. Wait a minute and try again." });
            if (!(await verifyPassword(w.account.hash, str(body.current, 1000)))) { strike("signin:" + ip); return json(res, 403, { error: "Your current password isn't right." }); }
        }
        const no = await accounts.update(w.account.id, {
            ...(typeof body.name === "string" && { name: str(body.name, 80) }),
            ...(typeof body.password === "string" && { password: str(body.password, 1000) })
        });
        return no ? json(res, 400, { error: no }) : json(res, 200, { ok: true });
    }

    // The node admin sees everyone; a library admin needs names to hand out roles.
    if (path === "/api/accounts" && req.method === "GET") {
        const w = whoIs(req);
        if (w.account?.admin) {
            return json(res, 200, {
                signup: accounts.signup,
                accounts: accounts.list().map(a => ({ id: a.id, username: a.username, name: a.name, admin: a.admin, disabled: !!a.disabled, created: a.created, devices: a.devices.length }))
            });
        }
        if (w.account && libraries.list().some(l => mayAdminister(l, w.account))) {
            return json(res, 200, { accounts: accounts.list().filter(a => !a.disabled).map(a => ({ id: a.id, username: a.username, name: a.name })) });
        }
        return json(res, 403, { error: "Only admins can see the list of accounts." });
    }

    if (path === "/api/accounts/update" && req.method === "POST") {
        const body = await readBody(req);
        if (!whoIs(req).account?.admin) return json(res, 403, { error: "Only the node admin can change other people's accounts." });
        const id = str(body.id, 64);
        if (typeof body.password === "string" && body.password.length < MIN_PASSWORD) return json(res, 400, { error: `A password needs at least ${MIN_PASSWORD} characters.` });
        const no = await accounts.update(id, {
            ...(typeof body.name === "string" && { name: body.name }),
            ...(typeof body.password === "string" && { password: body.password }),
            ...(typeof body.admin === "boolean" && { admin: body.admin }),
            ...(typeof body.disabled === "boolean" && { disabled: body.disabled })
        });
        if (no) return json(res, 400, { error: no });
        if (body.disabled === true || typeof body.password === "string") sessions.signOutEverywhere(id);
        return json(res, 200, { ok: true });
    }

    if (path === "/api/accounts/signup" && req.method === "POST") {
        const body = await readBody(req);
        if (!whoIs(req).account?.admin) return json(res, 403, { error: "Only the node admin can change this." });
        accounts.setSignup(body.open === true);
        return json(res, 200, { signup: accounts.signup });
    }

    // ---- libraries: made by the node admin, each run by its own admins ----

    if (path === "/api/libraries/create" && req.method === "POST") {
        const body = await readBody(req);
        if (!whoIs(req).account?.admin) return json(res, 403, { error: "Only the node admin can make libraries." });
        const made = await libraries.create({ id: str(body.id, 64), name: str(body.name, 80), password: str(body.password, 1000) || null, upload: body.upload });
        if (typeof made === "string") return json(res, 400, { error: made });
        console.log(`library made: ${made.id}${made.password ? " (protected)" : ""}`);
        return json(res, 200, { id: made.id });
    }

    if (path === "/api/directory" && req.method === "GET") {
        const lib = libraryFor(url);
        const w = whoIs(req);
        if (!lib) return json(res, 404, { error: "There's no library with that name here.", ...directory(libraries.get(MAIN)!, w) });
        return json(res, 200, directory(lib, w));
    }

    // a library's password, for this browser
    if (path === "/api/unlock" && req.method === "POST") {
        const lib = libraryFor(url);
        if (!lib) return json(res, 404, { error: "There's no library with that name here." });
        const body = await readBody(req);
        const key = `unlock:${ip}:${lib.id}`;
        if (struckOut(key)) return json(res, 429, { error: "Too many wrong tries. Wait a minute and try again." });
        if (!lib.password) return json(res, 200, { ok: true });
        if (!(await verifyPassword(lib.password, str(body.password, 1000)))) { strike(key); return json(res, 403, { error: "That isn't this library's password." }); }
        const session = sessions.ensure(req, res, secure);
        session.unlocked[lib.id] = lib.passwordSet!;
        sessions.changed();
        return json(res, 200, { ok: true });
    }

    if (path === "/api/lock" && req.method === "POST") {
        const lib = libraryFor(url);
        const session = sessions.read(req);
        if (lib && session) { delete session.unlocked[lib.id]; sessions.changed(); }
        return json(res, 200, { ok: true });
    }

    // Everything below is about one library, and needs it open.
    const lib = path.startsWith("/api/") ? libraryFor(url) : libraries.get(MAIN);
    if (!lib) return json(res, 404, { error: "There's no library with that name here." });
    const log = libraries.log(lib.id);

    if (path === "/api/libraries/settings" && req.method === "POST") {
        const body = await readBody(req);
        const w = whoIs(req);
        if (!mayAdminister(lib, w.account)) return json(res, 403, { error: "Only this library's admins can change its settings." });
        if ("password" in body) {
            if (body.password !== null && typeof body.password !== "string") return json(res, 400, { error: "password must be a string or null" });
            const no = await libraries.setPassword(lib, (body.password as string | null) || null);
            if (no) return json(res, 400, { error: no });
        }
        let watch: { folder: string } | null | undefined;
        if ("watch" in body) {
            // a folder on the node's own disk: only for whoever looks after the node
            if (!w.account?.admin) return json(res, 403, { error: "Only the node admin can choose a folder on the node." });
            const folder = str(body.watch, 1000).trim();
            if (folder && (!isAbsolute(folder) || !existsSync(folder) || !statSync(folder).isDirectory())) return json(res, 400, { error: "That isn't a folder on the node (give its full path)." });
            watch = folder ? { folder: resolve(folder) } : null;
        }
        // what goes out to the drop points' flash is for whoever looks after the node
        if (typeof body.droppoints === "boolean" && !w.account?.admin) return json(res, 403, { error: "Only the node admin can send a library to the drop points." });
        if (typeof body.droppoints === "boolean" && lib.id === MAIN) return json(res, 400, { error: "The main library always goes to the drop points." });
        libraries.update(lib, {
            ...(typeof body.name === "string" && { name: body.name }),
            ...(Array.isArray(body.upload) && { upload: cleanUploaders(body.upload) }),
            ...(watch !== undefined && { watch }),
            ...(typeof body.droppoints === "boolean" && { droppoints: body.droppoints })
        });
        if (watch !== undefined) watcher.refresh();
        return json(res, 200, directory(lib, w));
    }

    if (path === "/api/libraries/delete" && req.method === "POST") {
        if (!whoIs(req).account?.admin) return json(res, 403, { error: "Only the node admin can delete libraries." });
        if (lib.id === MAIN) return json(res, 400, { error: "The main library can't be deleted." });
        libraries.remove(lib.id);
        watcher.refresh();
        console.log(`library deleted: ${lib.id} (its folder is in data/libraries/.deleted/)`);
        return json(res, 200, { ok: true });
    }

    if (path === "/api/libraries/roles" && req.method === "POST") {
        const body = await readBody(req);
        const w = whoIs(req);
        if (!mayAdminister(lib, w.account)) return json(res, 403, { error: "Only this library's admins can give roles." });
        const account = accounts.get(str(body.account, 64));
        if (!account) return json(res, 404, { error: "No such account." });
        const roles = cleanRoles(body.roles);
        if (roles.length) lib.roles[account.id] = roles;
        else delete lib.roles[account.id];
        libraries.save();
        return json(res, 200, directory(lib, w));
    }

    if (path === "/api/libraries/groups" && req.method === "POST") {
        const body = await readBody(req);
        const w = whoIs(req);
        if (!mayAdminister(lib, w.account)) return json(res, 403, { error: "Only this library's admins can change its groups." });
        const id = str(body.id, 64);
        if (body.delete === true) {
            lib.groups = lib.groups.filter(g => g.id !== id);
        } else {
            const members = Array.isArray(body.members) ? [...new Set(body.members.filter((m): m is string => typeof m === "string" && !!accounts.get(m)))] : undefined;
            const name = str(body.name, 80).trim();
            const group = lib.groups.find(g => g.id === id);
            if (group) {
                if (name) group.name = name;
                if (members) group.members = members;
            } else {
                if (!name) return json(res, 400, { error: "A group needs a name." });
                if (lib.groups.length >= 200) return json(res, 400, { error: "This library can't take more groups." });
                lib.groups.push({ id: `g-${randomBytes(4).toString("hex")}`, name, members: members ?? [] });
            }
        }
        libraries.save();
        return json(res, 200, directory(lib, w));
    }

    // what a joining phone needs to be told, for a library this browser may open
    const w = whoIs(req);
    const open = mayOpen(lib, w.account, w.session);

    // the whole library as one zip, for anyone who may open it (You → Export the library)
    if (path === "/api/export") {
        if (!open) return locked(res, lib);
        const identity = identityOf(lib);
        const skip = log.notFor(w.account?.id ?? null, identity, mayAdminister(lib, w.account));
        const cat = lib.id === MAIN ? catalog() : { stewards: [], ops: [] };
        const ops = [...cat.ops, ...log.log.filter(o => !skip(o))];
        const fileFor = (doc: { hash?: string, url?: string }) => {
            if (doc.url && !/^[a-z]+:/i.test(doc.url)) {
                const f = join(STATIC, normalize(doc.url).replace(/^([/\\])+/, ""));
                if (f.startsWith(STATIC + sep) && existsSync(f)) return f;
            }
            if (doc.hash && HASH.test(doc.hash) && existsSync(join(MEDIA, doc.hash))) return join(MEDIA, doc.hash);
            return null;
        };
        const day = new Date().toISOString().slice(0, 10);
        const people = {
            viewer: w.account?.id ?? "", stewards: [...cat.stewards, ...stewardsOf(lib, accounts.list())], identity,
            accounts: Object.fromEntries(accounts.list().map(a => [a.id, a.name]))
        };
        console.log(`export of ${lib.id}: ${ops.length} ops`);
        await sendZip(res, `osl-${lib.id === MAIN ? "library" : lib.id}-${day}.zip`, exportEntries(ops, people, fileFor, appVersion() || "?"));
        return;
    }

    // The one request every device repeats: "what's new since my cursor?" It also
    // says who is asking and what they have open, which is all presence needs.
    if (path === "/api/ops" && req.method === "GET") {
        if (!open) return locked(res, lib);
        const after = log.position(url.searchParams.get("after"));
        const user = (url.searchParams.get("user") ?? "").slice(0, 64);
        // a signed-in device is only "here" when its own account is
        const owner = user ? accounts.ownerOf(user) : undefined;
        if (user && (!owner || owner === w.account?.id)) log.board.hello(user, (url.searchParams.get("viewing") ?? "").slice(0, 200), Date.now());
        const identity = identityOf(lib);
        const viewer = w.account?.id ?? null;
        // a library's admins see everyone's Kept (W-D12); everyone else only what is for them
        const admin = mayAdminister(lib, w.account);
        const skip = log.notFor(viewer, identity, admin);
        let ops = log.log.slice(after).filter(o => !skip(o));
        // someone who may have been let into a collection since: send what was in it
        const access = `${log.accessRevision}.${libraries.revision}`;
        if (viewer && url.searchParams.get("access") !== access) {
            const have = new Set(ops.map(o => o.id));
            ops = [...log.sharedWith(viewer, identity, admin).filter(o => !have.has(o.id)), ...ops];
        }
        return json(res, 200, {
            ops, cursor: log.cursorNow(), presence: log.board.snapshot(Date.now()), node: log.node,
            directory: libraries.revision, access
        });
    }

    if (path === "/api/suggestions" && req.method === "POST") {
        const body = await readBody(req);
        const text = typeof body.text === "string" ? body.text.trim() : "";
        if (!text) return json(res, 400, { error: "Write something first." });
        const field = (k: string, max: number) => typeof body[k] === "string" ? (body[k] as string).trim().slice(0, max) : "";
        const entry = {
            id: randomBytes(6).toString("hex"),
            receivedAt: new Date().toISOString(),
            kind: SUGGESTION_KINDS.includes(body.kind as string) ? body.kind : "other",
            text: text.slice(0, 5000),
            contact: field("contact", 200),
            page: field("page", 300),
            device: field("device", 500),
            app: field("app", 40),
            via: field("via", 20)          // "library", or "drop point" if it waited on the phone
        };
        if (existsSync(SUGGESTIONS) && statSync(SUGGESTIONS).size > SUGGESTIONS_MAX_FILE) {
            return json(res, 507, { error: "The suggestions box is full. Tell the developer in person, please." });
        }
        appendFileSync(SUGGESTIONS, JSON.stringify(entry) + "\n");
        console.log(`suggestion received (${entry.kind}): ${entry.text.slice(0, 60).replace(/\s+/g, " ")}${entry.text.length > 60 ? "…" : ""}`);
        return json(res, 200, { ok: true });
    }
    if (path === "/api/suggestions" && req.method === "GET") {
        const key = String(req.headers["x-osl-key"] ?? "");
        const want = suggestionsKey();
        if (key.length !== want.length || !timingSafeEqual(Buffer.from(key), Buffer.from(want))) {
            return json(res, 403, { error: "That isn't the key. It's printed in the node's console when it starts." });
        }
        const list = existsSync(SUGGESTIONS)
            ? readFileSync(SUGGESTIONS, "utf8").split("\n").filter(Boolean).flatMap(l => { try { return [JSON.parse(l)]; } catch { return []; } }).reverse()
            : [];
        return json(res, 200, { suggestions: list });
    }

    if (path === "/api/pair" && req.method === "POST") {
        const body = await readBody(req) as { code?: unknown, role?: unknown };
        if (struckOut("code:" + ip)) return json(res, 429, { error: "Too many wrong codes. Wait a minute and try again." });
        if (body.role !== "presenter" && body.role !== "station") return json(res, 400, { error: "role must be presenter or station" });
        if (body.code !== PAIR_CODE) {
            strike("code:" + ip);
            return json(res, 403, { error: "That isn't the code on the library's screen." });
        }
        strikes.delete("code:" + ip);
        console.log(`paired a ${body.role}`);
        return json(res, 200, { role: body.role, token: pair(body.role) });
    }

    if (path === "/api/showing" && req.method === "POST") {
        const body = await readBody(req) as { token?: unknown, documentId?: unknown, user?: unknown };
        const p = whoIs(req, body.token);
        if (!open) return locked(res, lib);
        if (!mayPresent(lib, p.account, p.paired)) return json(res, 403, { error: "This device isn't paired as a presenter." });
        if (body.documentId === null || body.documentId === "") log.board.showing = null;
        else if (typeof body.documentId === "string" && body.documentId.length <= 200) {
            log.board.showing = { documentId: body.documentId, by: String(body.user ?? "").slice(0, 64), since: new Date().toISOString() };
        } else return json(res, 400, { error: "expected { documentId }" });
        return json(res, 200, { showing: log.board.showing });
    }

    if (path === "/api/upload" && req.method === "POST") {
        if (!open) { req.resume(); return locked(res, lib); }
        if (!mayUpload(lib, w.account, w.paired)) { req.resume(); return json(res, 403, { error: "Adding documents to this library isn't open to everyone." }); }
        const sent = String(req.headers["content-type"] ?? "").split(";")[0].trim().toLowerCase();
        const type = MIME.test(sent) ? sent : "application/octet-stream";
        if (Number(req.headers["content-length"] ?? 0) > MAX_UPLOAD) { req.resume(); return json(res, 413, { error: tooLarge(MAX_UPLOAD) }); }
        const saved = await receiveUpload(req, type, MAX_UPLOAD, LOOKS[type]);
        log.hashes.add(saved.hash);    // so whoever may open this library may fetch it, before the op arrives
        console.log(`${w.paired.station ? "station" : "a device"} uploaded ${saved.hash.slice(0, 15)}… to ${lib.id} (${saved.size} bytes, ${type})`);
        return json(res, 200, { ...saved, fileType: type });
    }

    if (path === "/api/ops" && req.method === "POST") {
        if (!open) return locked(res, lib);
        const body = await readBody(req) as { ops?: unknown };
        if (!Array.isArray(body.ops)) return json(res, 400, { error: "expected { ops: [...] }" });
        const result = log.accept(body.ops, authorRule(lib, w));
        if (result.added) console.log(`+${result.added} ops in ${lib.id} (total ${log.log.length})`);
        return json(res, 200, result);
    }

    if (path === "/api/media" && req.method === "POST") {
        if (!open) return locked(res, lib);
        if (!mayUpload(lib, w.account, w.paired)) return json(res, 403, { error: "Adding documents to this library isn't open to everyone." });
        const body = await readBody(req) as { hash?: unknown, data?: unknown };
        if (typeof body.hash !== "string" || !HASH.test(body.hash) || typeof body.data !== "string") {
            return json(res, 400, { error: "expected { hash, data }" });
        }
        const m = DATA_URL.exec(body.data);
        if (!m) return json(res, 400, { error: "data must be a base64 data URL" });
        writeFileSync(join(MEDIA, body.hash), Buffer.from(m[2], "base64"));
        writeFileSync(join(MEDIA, body.hash + ".type"), m[1]);
        log.hashes.add(body.hash);
        return json(res, 200, { ok: true });
    }

    if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: "method not allowed" });

    if (path === "/ca.pem") return serveCa(res);

    // media people uploaded: held once for every library, given to whoever may open one that has it
    if (path.startsWith("/media/")) {
        const hash = path.slice("/media/".length);
        const file = join(MEDIA, hash);
        if (!HASH.test(hash) || !existsSync(file)) return json(res, 404, { error: "not found" });
        const here = libraries.list().filter(l => libraries.log(l.id).hashes.has(hash));
        if (!here.some(l => mayOpen(l, w.account, w.session))) {
            return here.length ? locked(res, here[0]) : json(res, 404, { error: "not found" });
        }
        const type = existsSync(file + ".type") ? readFileSync(file + ".type", "utf8") : "application/octet-stream";
        // An uploaded file never runs as a page on the library's address: the sandbox
        // stops scripts if someone opens it directly (images, audio and fetches in the
        // app don't notice it), and types the browser shouldn't open are downloaded.
        // A protected library's files aren't kept by anything in between.
        sendFile(req, res, file, type, {
            "cache-control": here.some(l => !l.password) ? "public, max-age=31536000, immutable" : "private, max-age=31536000, immutable",
            "x-content-type-options": "nosniff",
            "content-security-policy": "sandbox; default-src 'none'; img-src 'self' data:; media-src 'self'; style-src 'unsafe-inline'",
            ...(!INLINE.test(type) && { "content-disposition": "attachment" })
        });
        return;
    }

    // the built app and the library files
    const rel = normalize(path === "/" ? "/index.html" : path).replace(/^([/\\])+/, "");
    const file = join(STATIC, rel);
    if (!file.startsWith(STATIC + sep) || !existsSync(file) || !statSync(file).isFile()) {
        return json(res, 404, { error: "not found" });
    }
    // the main library's catalog and its files are the main library's: protected with it
    if ((rel === "catalog.json" || rel.startsWith("library" + sep)) && !mayOpen(libraries.get(MAIN)!, w.account, w.session)) {
        return locked(res, libraries.get(MAIN)!);
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
    const others = libraries.list().length - 1;
    console.log(`\nOSL node running — ${main.log.length} ops in the log${others ? ` (and ${others} other librar${others === 1 ? "y" : "ies"})` : ""}, app version ${version}${radio ? `, radio on ${process.env.RADIO_PORT}` : ""}\n`);
    console.log(`  this laptop:  ${scheme}://localhost:${PORT}`);
    for (const a of joinAddresses(scheme)) console.log(`  phones:       ${a}`);
    console.log(`  big screen:   ${scheme}://localhost:${PORT}/#/present`);
    console.log(`\n  Pairing code: ${PAIR_CODE}   (You → Pair this device, to present or as the digitization station)`);
    if (!accounts.count) console.log(`  No accounts yet: the first one made (You → Account) is the node admin, and needs this code.`);
    const waiting = existsSync(SUGGESTIONS) ? readFileSync(SUGGESTIONS, "utf8").split("\n").filter(Boolean).length : 0;
    console.log(`  Suggestions:  ${waiting} in the box. Read them at /#/suggestions with the key ${suggestionsKey()}  (or data/suggestions.jsonl)`);
    if (secure) {
        console.log(`\n  Phones trust it once: AirDrop certs/rootCA.pem to the phone, or open http://<address>:${PORT + 1}/ca.pem`);
        console.log("  then iPhone: Settings → Profile Downloaded → Install, and General → About → Certificate Trust Settings → on.");
    } else {
        console.log("\n  Plain http: phones can use it live on this Wi-Fi, but can't install it for offline use.");
        console.log("  For offline take-home, add certs/cert.pem + certs/key.pem (see README → Where the domain comes in).");
    }
    console.log("");
});
