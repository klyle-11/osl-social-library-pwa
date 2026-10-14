// Builds everything into dist/ (the static site) and dist-node/ (the server).
//   node scripts/build.mjs            one build
//   node scripts/build.mjs --watch    dev: rebuild on save, run the node, live-reload every open page
//     - app/core/adapters change  -> rebuild app.js, reload pages
//     - node/ or core/ change     -> rebuild and restart the node, reload pages
//     - library/ change           -> re-run the catalog, copy files, reload pages
import * as esbuild from "esbuild";
import { cpSync, existsSync, mkdirSync, rmSync, watch as watchFs } from "node:fs";
import { spawn } from "node:child_process";
import { buildCatalog } from "./catalog.mjs";

const watch = process.argv.includes("--watch");
const version = new Date().toISOString().replace(/[^0-9]/g, "").slice(0, 14);

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist", { recursive: true });

function copyStatic() {
    cpSync("index.html", "dist/index.html");
    cpSync("styles.css", "dist/styles.css");
    cpSync("public", "dist", { recursive: true });
}

function copyLibrary() {
    buildCatalog();
    cpSync("library/catalog.json", "dist/catalog.json");
    if (existsSync("library/files")) cpSync("library/files", "dist/library/files", { recursive: true });
}

copyStatic();
copyLibrary();

const define = { OSL_DEV: JSON.stringify(watch) };
const app = {
    entryPoints: ["app/index.tsx"], bundle: true, outfile: "dist/app.js",
    format: "esm", target: "es2020", minify: !watch, sourcemap: true, logLevel: "info", define
};
const sw = {
    entryPoints: ["app/sw.ts"], bundle: true, outfile: "dist/sw.js",
    format: "iife", target: "es2020", minify: !watch, logLevel: "info",
    define: { OSL_VERSION: JSON.stringify(version) }
};
const server = {
    entryPoints: ["node/server.ts"], bundle: true, outfile: "dist-node/server.mjs",
    platform: "node", format: "esm", target: "node20", logLevel: "info"
};

if (!watch) {
    await Promise.all([esbuild.build(app), esbuild.build(sw), esbuild.build(server)]);
} else {
    let node = null;
    const reload = () => node?.connected && node.send({ type: "reload" });
    const startNode = () => {
        node = spawn(process.execPath, ["dist-node/server.mjs"], {
            stdio: ["inherit", "inherit", "inherit", "ipc"],
            env: { ...process.env, OSL_DEV: "1" }
        });
    };
    const onBuilt = (name, after) => ({
        name,
        setup(b) {
            b.onEnd(result => { if (!result.errors.length) after(); });
        }
    });

    let first = true;
    const serverCtx = await esbuild.context({
        ...server,
        plugins: [onBuilt("restart-node", () => {
            if (node) node.kill();
            startNode();
            // give the new node a moment to listen, then reload pages (they reconnect)
            if (!first) setTimeout(reload, 300);
            first = false;
        })]
    });
    await serverCtx.watch();

    await (await esbuild.context({ ...app, plugins: [onBuilt("reload", reload)] })).watch();
    await (await esbuild.context(sw)).watch();

    // documents: drop a file in library/files or edit documents.json
    let timer;
    watchFs("library", { recursive: true }, (_event, file) => {
        if (!file || file.endsWith("catalog.json") || file.includes(".DS_Store")) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
            try {
                copyLibrary();
                reload();
            } catch (e) {
                console.error("catalog:", e.message);
            }
        }, 300);
    });
    watchFs(".", (_event, file) => {
        if (file === "index.html" || file === "styles.css") { copyStatic(); reload(); }
    });
    watchFs("public", { recursive: true }, () => { copyStatic(); reload(); });

    process.on("SIGINT", () => { node?.kill(); process.exit(0); });
}
