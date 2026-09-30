// The node (gate two + three): serves the app, stores ops durably, answers /sync,
// and stores content-addressed media. No dependencies beyond Node itself.
//
//   HTTP  (dev, localhost is a secure context):   node server.js
//   HTTPS (phones on the LAN / the archive Pi):   TLS_CERT=certs/cert.pem TLS_KEY=certs/key.pem node server.js
//
// Env: PORT (8080 http / 8443 https), HOST (0.0.0.0), DATA_DIR (./data),
//      TLS_CERT, TLS_KEY, HTTP_REDIRECT_PORT (optional: also listen on plain http; it serves the
//      dev CA at /ca.pem for installing on test phones, and redirects everything else to https)

import http from "node:http";
import https from "node:https";
import fs from "node:fs";
import fsp from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { validateOp } from "./src/contract.js";

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = path.resolve(process.env.DATA_DIR || path.join(ROOT, "data"));
const OPS_FILE = path.join(DATA_DIR, "ops.jsonl");
const MEDIA_DIR = path.join(DATA_DIR, "media");
const TLS = process.env.TLS_CERT && process.env.TLS_KEY;
const PORT = Number(process.env.PORT || (TLS ? 8443 : 8080));
const HOST = process.env.HOST || "0.0.0.0";
const MAX_BODY = 50 * 1024 * 1024;

// Only these are served as static files; everything else in the repo stays private.
const PUBLIC = new Set(["index.html", "styles.css", "sw.js", "manifest.webmanifest", "dist/app.js", "dist/app.js.map", "dist/library.json"]);
const TYPES = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
    ".map": "application/json",
    ".webmanifest": "application/manifest+json",
    ".png": "image/png",
    ".woff2": "font/woff2",
    ".json": "application/json",
    ".txt": "text/plain; charset=utf-8",
    ".md": "text/markdown; charset=utf-8",
    ".pdf": "application/pdf",
    ".epub": "application/epub+zip",
};

// ---- op log: append-only JSONL, one line per op, fsync before ack ----

fs.mkdirSync(MEDIA_DIR, { recursive: true });
/** @type {{seq: number, op: any}[]} */
const log = [];
const seen = new Set();
if (fs.existsSync(OPS_FILE)) {
    for (const line of fs.readFileSync(OPS_FILE, "utf8").split("\n")) {
        if (!line.trim()) continue;
        try {
            const entry = JSON.parse(line);
            if (seen.has(entry.op.id)) continue;
            log.push(entry);
            seen.add(entry.op.id);
        } catch {
            // a torn final line from a power cut: never acked, safe to drop
        }
    }
}
const opsFd = fs.openSync(OPS_FILE, "a");
console.log(`Loaded ${log.length} ops from ${OPS_FILE}`);

let writing = Promise.resolve();
function appendOps(ops) {
    // Serialize writers so sequence numbers match file order.
    writing = writing.then(() => {
        const fresh = [];
        for (const op of ops) {
            if (seen.has(op.id)) continue;
            seen.add(op.id);
            fresh.push({ seq: log.length + fresh.length + 1, op });
        }
        if (fresh.length) {
            fs.writeSync(opsFd, fresh.map((e) => JSON.stringify(e)).join("\n") + "\n");
            fs.fsyncSync(opsFd); // durable before we ack
            log.push(...fresh);
        }
    });
    return writing;
}

// ---- http ----

function send(res, status, body, headers = {}) {
    const isJson = typeof body === "object" && !(body instanceof Buffer);
    res.writeHead(status, {
        "Content-Type": isJson ? "application/json" : "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
        ...headers,
    });
    res.end(isJson ? JSON.stringify(body) : body);
}

function readBody(req) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        req.on("data", (c) => {
            size += c.length;
            if (size > MAX_BODY) {
                reject(Object.assign(new Error("too large"), { status: 413 }));
                req.destroy();
            } else chunks.push(c);
        });
        req.on("end", () => resolve(Buffer.concat(chunks)));
        req.on("error", reject);
    });
}

async function handleSync(req, res) {
    const body = JSON.parse((await readBody(req)).toString("utf8") || "{}");
    const incoming = Array.isArray(body.ops) ? body.ops : [];
    const valid = incoming.filter((op) => !validateOp(op));
    await appendOps(valid);
    const since = Number(body.since) || 0;
    send(res, 200, {
        acked: valid.map((op) => op.id), // durable now (or already were)
        rejected: incoming.filter((op) => validateOp(op)).map((op) => ({ id: op && op.id, error: validateOp(op) })),
        ops: log.filter((e) => e.seq > since).map((e) => e.op),
        cursor: log.length,
    });
}

const HASH_RE = /^sha256-[0-9a-f]{64}$/;

async function handleMedia(req, res, hash) {
    if (!HASH_RE.test(hash)) return send(res, 400, "bad hash");
    const file = path.join(MEDIA_DIR, hash);
    if (req.method === "PUT") {
        if (fs.existsSync(file)) return send(res, 200, "have it");
        const data = await readBody(req);
        const actual = "sha256-" + crypto.createHash("sha256").update(data).digest("hex");
        if (actual !== hash) return send(res, 400, "hash mismatch");
        const tmp = file + ".tmp";
        const fd = fs.openSync(tmp, "w");
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
        fs.closeSync(fd);
        fs.renameSync(tmp, file);
        fs.writeFileSync(file + ".type", String(req.headers["content-type"] || "application/octet-stream"));
        return send(res, 201, "stored");
    }
    if (req.method === "GET") {
        if (!fs.existsSync(file)) return send(res, 404, "not found");
        const type = fs.existsSync(file + ".type") ? fs.readFileSync(file + ".type", "utf8") : "application/octet-stream";
        res.writeHead(200, { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable" });
        return fs.createReadStream(file).pipe(res);
    }
    send(res, 405, "method not allowed");
}

/** For testing: what the node holds. "ops" should equal "uniqueIds" - each op stored exactly once. */
function status() {
    const authors = new Set(log.map((e) => e.op.author));
    const byType = {};
    for (const e of log) byType[e.op.type] = (byType[e.op.type] || 0) + 1;
    return {
        ops: log.length,
        uniqueIds: new Set(log.map((e) => e.op.id)).size,
        devices: authors.size,
        byType,
        media: fs.readdirSync(MEDIA_DIR).filter((f) => HASH_RE.test(f)).length,
        latest: log.slice(-10).map((e) => ({ seq: e.seq, id: e.op.id, type: e.op.type, created: e.op.created })),
    };
}

async function serveStatic(req, res, rel) {
    if (rel === "" || rel.endsWith("/")) rel += "index.html";
    if (!PUBLIC.has(rel) && !/^icons\/[\w-]+\.png$/.test(rel) && !/^library\/files\/[^/]+$/.test(rel) && !/^fonts\/[\w-]+\.woff2$/.test(rel)) {
        // unknown paths are app routes: hand back the shell
        if (!path.extname(rel)) rel = "index.html";
        else return send(res, 404, "not found");
    }
    try {
        const data = await fsp.readFile(path.join(ROOT, rel));
        res.writeHead(200, {
            "Content-Type": TYPES[path.extname(rel)] || "application/octet-stream",
            // the service worker does the offline caching; browsers must always revalidate
            "Cache-Control": "no-cache",
            ...(rel === "sw.js" ? { "Service-Worker-Allowed": "/" } : {}),
        });
        res.end(req.method === "HEAD" ? undefined : data);
    } catch {
        send(res, 404, rel === "dist/app.js" ? "not built yet: run npm run build" : "not found");
    }
}

async function handler(req, res) {
    try {
        const url = new URL(req.url, "http://x");
        const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
        if (rel.includes("..")) return send(res, 400, "bad path");
        if (TLS) res.setHeader("Strict-Transport-Security", "max-age=31536000");
        if (rel === "sync") {
            if (req.method !== "POST") return send(res, 405, "POST only");
            return await handleSync(req, res);
        }
        if (rel.startsWith("media/")) return await handleMedia(req, res, rel.slice(6));
        if (rel === "status") return send(res, 200, status());
        if (req.method !== "GET" && req.method !== "HEAD") return send(res, 405, "method not allowed");
        return await serveStatic(req, res, rel);
    } catch (e) {
        console.error(e);
        send(res, e.status || (e instanceof SyntaxError ? 400 : 500), e.message);
    }
}

function lanUrls(scheme, port) {
    const ips = Object.values(os.networkInterfaces())
        .flat()
        .filter((a) => a && a.family === "IPv4" && !a.internal)
        .map((a) => a.address);
    const suffix = (scheme === "https" && port === 443) || (scheme === "http" && port === 80) ? "" : ":" + port;
    return ["localhost", ...ips].map((h) => `  ${scheme}://${h}${suffix}/`).join("\n");
}

// Serves the dev CA over plain http so a test phone can install it before it trusts https.
const CA_FILE = process.env.CA_FILE || path.join(ROOT, "certs", "ca.pem");
function httpHelper(req, res) {
    const rel = new URL(req.url, "http://x").pathname;
    if ((rel === "/ca.pem" || rel === "/ca.crt") && fs.existsSync(CA_FILE)) {
        res.writeHead(200, {
            "Content-Type": "application/x-x509-ca-cert",
            "Content-Disposition": 'attachment; filename="osl-dev-ca.crt"',
        });
        return res.end(fs.readFileSync(CA_FILE));
    }
    const host = (req.headers.host || "").replace(/:\d+$/, "");
    res.writeHead(301, { Location: `https://${host}${PORT === 443 ? "" : ":" + PORT}${req.url}` });
    res.end();
}

if (TLS) {
    https
        .createServer({ cert: fs.readFileSync(process.env.TLS_CERT), key: fs.readFileSync(process.env.TLS_KEY) }, handler)
        .listen(PORT, HOST, () => console.log(`OSL node on\n${lanUrls("https", PORT)}`));
    const redirect = process.env.HTTP_REDIRECT_PORT;
    if (redirect) {
        http.createServer(httpHelper).listen(Number(redirect), HOST, () => {
            console.log(`Plain http on port ${redirect} redirects to https.`);
            if (fs.existsSync(CA_FILE)) console.log(`Test phones can install the dev CA from http://<LAN-IP>:${redirect}/ca.pem`);
        });
    }
} else {
    http.createServer(handler).listen(PORT, HOST, () => {
        console.log(`OSL node on\n${lanUrls("http", PORT)}`);
        console.log("Plain HTTP: offline mode only works on localhost. Set TLS_CERT/TLS_KEY for phones.");
    });
}
