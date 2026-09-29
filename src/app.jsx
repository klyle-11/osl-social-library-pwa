// OSL - Offline Social Library. Plain HTML elements, no CSS.

import { render } from "preact";
import { useState, useEffect, useCallback, useMemo } from "preact/hooks";
import { itemsView, threadView, collectionsView, collectionOps, mediaHashes, ACCESS, MEDIUMS } from "./contract.js";
import { addLocalOp, requeueOwnOps, allOps, outboxOps, getDeviceId, getMeta, hashBlob, putMedia, hasMedia, mediaUrl, requestPersistence } from "./db.js";
import { sync, fetchMedia } from "./sync.js";
import { buildBundleFile, shareOrDownload, importBundleFile } from "./bundle.js";

// ---- service worker + install ----

if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch((e) => console.warn("SW registration failed", e));
}

let deferredInstall = null;
window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // Android/Chrome: show our own Install button
    deferredInstall = e;
    window.dispatchEvent(new Event("osl-installable"));
});

const isStandalone = () => matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// ---- state ----

function useLibrary() {
    const [ops, setOps] = useState([]);
    const [pending, setPending] = useState(new Set());
    const [me, setMe] = useState("");
    const [lastSync, setLastSync] = useState(null);

    const reload = useCallback(async () => {
        const [all, out, id, last] = await Promise.all([allOps(), outboxOps(), getDeviceId(), getMeta("lastSync")]);
        setOps(all);
        setPending(new Set(out.map((op) => op.id)));
        setMe(id);
        setLastSync(last);
    }, []);

    useEffect(() => {
        reload();
    }, [reload]);

    return { ops, pending, me, lastSync, reload };
}

function useOnline() {
    const [online, setOnline] = useState(navigator.onLine);
    useEffect(() => {
        const on = () => setOnline(true);
        const off = () => setOnline(false);
        addEventListener("online", on);
        addEventListener("offline", off);
        return () => {
            removeEventListener("online", on);
            removeEventListener("offline", off);
        };
    }, []);
    return online;
}

// ---- components ----

function App() {
    const lib = useLibrary();
    const online = useOnline();
    const [status, setStatus] = useState("");
    const [view, setView] = useState({ name: "library" });
    const [persisted, setPersisted] = useState(null);

    const runSync = useCallback(async () => {
        try {
            setStatus("Syncing…");
            const r = await sync();
            setStatus(`Synced: sent ${r.sent}, received ${r.received}.`);
        } catch (e) {
            console.warn("sync failed", e);
            setStatus("Not synced (node not reachable). Everything is kept on this device.");
        }
        lib.reload();
    }, [lib.reload]);

    useEffect(() => {
        requestPersistence().then(setPersisted);
        runSync();
        const onVisible = () => document.visibilityState === "visible" && runSync();
        addEventListener("online", runSync);
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            removeEventListener("online", runSync);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [runSync]);

    const act = useCallback(
        async (fields) => {
            await addLocalOp(fields);
            await lib.reload();
            if (navigator.onLine) runSync();
        },
        [lib.reload, runSync],
    );

    const ctx = { ...lib, act, setView, setStatus };

    return (
        <main>
            <header>
                <nav>
                    <button onClick={() => setView({ name: "library" })}>Library</button>{" "}
                    <button onClick={() => setView({ name: "add" })}>Add item</button>{" "}
                    <button onClick={() => setView({ name: "collections" })}>Collections</button>{" "}
                    <button onClick={() => setView({ name: "device" })}>This device</button>
                </nav>
                <p>
                    {online ? "Online" : "Offline"} · {lib.pending.size} waiting to send ·{" "}
                    <button onClick={runSync} disabled={!online}>
                        Sync now
                    </button>
                </p>
                {status && (
                    <p role="status">
                        <small>{status}</small>
                    </p>
                )}
                <InstallHint />
                <hr />
            </header>

            {view.name === "library" && <Library {...ctx} />}
            {view.name === "item" && <ItemView {...ctx} itemId={view.id} />}
            {view.name === "add" && <AddItem {...ctx} />}
            {view.name === "collections" && <Collections {...ctx} />}
            {view.name === "device" && <Device {...ctx} persisted={persisted} online={online} />}
        </main>
    );
}

function InstallHint() {
    const [canInstall, setCanInstall] = useState(!!deferredInstall);
    useEffect(() => {
        const on = () => setCanInstall(true);
        addEventListener("osl-installable", on);
        return () => removeEventListener("osl-installable", on);
    }, []);
    if (isStandalone()) return null;
    if (canInstall)
        return (
            <p>
                <button
                    onClick={async () => {
                        deferredInstall.prompt();
                        await deferredInstall.userChoice;
                        deferredInstall = null;
                        setCanInstall(false);
                    }}
                >
                    Install app (works offline)
                </button>
            </p>
        );
    if (isIOS())
        return (
            <p>
                <small>
                    To take OSL offline on iPhone/iPad: open in Safari, tap <b>Share</b>, then <b>Add to Home Screen</b>.
                </small>
            </p>
        );
    return null;
}

function Pending({ pending, id }) {
    return <small>{pending.has(id) ? " (waiting to send)" : " (saved at the archive)"}</small>;
}

function Library({ ops, pending, setView }) {
    const items = useMemo(() => itemsView(ops), [ops]);
    const [q, setQ] = useState("");
    const shown = items.filter((it) => {
        const p = it.properties;
        return !q || [p.title, p.author, p.subtitle, p.type, p.description].join(" ").toLowerCase().includes(q.toLowerCase());
    });
    return (
        <section>
            <h2>Library</h2>
            <p>
                <label>
                    Search <input type="search" value={q} onInput={(e) => setQ(e.currentTarget.value)} />
                </label>
            </p>
            {shown.length === 0 && <p>No items yet.</p>}
            <ul>
                {shown.map((it) => (
                    <li key={it.id}>
                        <a
                            href={"#" + it.id}
                            onClick={(e) => {
                                e.preventDefault();
                                setView({ name: "item", id: it.id });
                            }}
                        >
                            {it.properties.title}
                        </a>
                        {it.properties.author && <> — {it.properties.author}</>}
                        {it.properties.type && <i> ({it.properties.type})</i>}
                        <Pending pending={pending} id={it.id} />
                    </li>
                ))}
            </ul>
        </section>
    );
}

function MediaLink({ hash, name, fileType }) {
    const [have, setHave] = useState(null);
    useEffect(() => {
        hasMedia(hash).then(setHave);
    }, [hash]);
    return (
        <p>
            <a href={mediaUrl(hash)} target="_blank" rel="noopener">
                Open {name || "file"}
            </a>{" "}
            <small>
                {fileType} · {have ? "available offline" : have === false ? "not on this device yet" : ""}
            </small>
        </p>
    );
}

function ItemView({ ops, pending, me, act, itemId, setView }) {
    const item = ops.find((op) => op.id === itemId);
    const thread = useMemo(() => threadView(ops, itemId, me), [ops, itemId, me]);
    const collections = useMemo(() => collectionsView(ops).filter((c) => c.owner === me), [ops, me]);
    const [body, setBody] = useState("");
    const [access, setAccess] = useState("public");
    const [target, setTarget] = useState("");

    if (!item) return <p>Item not found.</p>;
    const p = item.properties;

    return (
        <section>
            <p>
                <button onClick={() => setView({ name: "library" })}>← Back</button>
            </p>
            <h2>{p.title}</h2>
            {p.subtitle && <h3>{p.subtitle}</h3>}
            {p.description && <p>{p.description}</p>}
            <dl>
                <dt>Author</dt>
                <dd>{p.author || "—"}</dd>
                <dt>Medium</dt>
                <dd>{p.type || "—"}</dd>
                <dt>Added by</dt>
                <dd>
                    {item.author} on {new Date(item.created).toLocaleString()}
                    <Pending pending={pending} id={item.id} />
                </dd>
            </dl>
            {item.hash && <MediaLink hash={item.hash} name={item.name} fileType={item.fileType} />}
            {item.url && (
                <p>
                    <a href={item.url} target="_blank" rel="noopener">
                        {item.url}
                    </a>
                </p>
            )}

            <h3>Add to a collection</h3>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    let id = target;
                    if (id === "__new") {
                        const name = prompt("Collection name");
                        if (!name) return;
                        id = `${me}/${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now().toString(36)}`;
                        await act({ type: "name-collection", target: id, name: name.trim() });
                    }
                    if (id) await act({ type: "add-to-collection", target: id, item: itemId });
                    setTarget("");
                }}
            >
                <select value={target} onChange={(e) => setTarget(e.currentTarget.value)}>
                    <option value="">Choose…</option>
                    {collections.map((c) => (
                        <option key={c.id} value={c.id}>
                            {c.name}
                        </option>
                    ))}
                    <option value="__new">New collection…</option>
                </select>{" "}
                <button type="submit" disabled={!target}>
                    Add
                </button>
            </form>

            <h3>Annotations ({thread.length})</h3>
            <ol>
                {thread.map((c) => (
                    <li key={c.id}>
                        <p>{c.body}</p>
                        <small>
                            {c.access === "anonymous" ? "anonymous" : c.author} · {c.access} ·{" "}
                            {new Date(c.created).toLocaleString()}
                            <Pending pending={pending} id={c.id} />
                        </small>{" "}
                        <button
                            onClick={() => confirm("Hide this annotation for everyone?") && act({ type: "hide", target: c.id })}
                        >
                            Hide
                        </button>
                    </li>
                ))}
            </ol>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    if (!body.trim()) return;
                    await act({ type: "comment", target: itemId, body: body.trim(), access });
                    setBody("");
                }}
            >
                <p>
                    <label>
                        Annotation
                        <br />
                        <textarea rows={4} cols={40} value={body} onInput={(e) => setBody(e.currentTarget.value)} />
                    </label>
                </p>
                <p>
                    <label>
                        Visibility{" "}
                        <select value={access} onChange={(e) => setAccess(e.currentTarget.value)}>
                            {ACCESS.map((a) => (
                                <option key={a} value={a}>
                                    {a}
                                </option>
                            ))}
                        </select>
                    </label>{" "}
                    <button type="submit">Save</button>
                </p>
            </form>
        </section>
    );
}

function AddItem({ act, setView, setStatus }) {
    const [busy, setBusy] = useState(false);
    return (
        <section>
            <h2>Add an item</h2>
            <form
                onSubmit={async (e) => {
                    e.preventDefault();
                    const f = new FormData(e.currentTarget);
                    const file = f.get("file");
                    const url = String(f.get("url") || "").trim();
                    const properties = {
                        title: String(f.get("title")).trim(),
                        subtitle: String(f.get("subtitle") || "").trim() || undefined,
                        description: String(f.get("description") || "").trim() || undefined,
                        author: String(f.get("author") || "").trim(),
                        type: String(f.get("medium") || ""),
                    };
                    const hasFile = file && file.size > 0;
                    if (!hasFile && !url) return setStatus("Add a file or a link.");
                    setBusy(true);
                    const fields = { type: "item", properties };
                    if (url) fields.url = url;
                    if (hasFile) {
                        fields.hash = await hashBlob(file);
                        fields.name = file.name;
                        fields.fileType = file.type || "application/octet-stream";
                        await putMedia(fields.hash, file, fields.fileType);
                    }
                    await act(fields);
                    setBusy(false);
                    setView({ name: "library" });
                }}
            >
                <p>
                    <label>
                        Title <input name="title" required />
                    </label>
                </p>
                <p>
                    <label>
                        Subtitle <input name="subtitle" />
                    </label>
                </p>
                <p>
                    <label>
                        Description
                        <br />
                        <textarea name="description" rows={3} cols={40} />
                    </label>
                </p>
                <p>
                    <label>
                        Author <input name="author" />
                    </label>
                </p>
                <p>
                    <label>
                        Medium{" "}
                        <select name="medium">
                            {MEDIUMS.map((m) => (
                                <option key={m} value={m}>
                                    {m || "—"}
                                </option>
                            ))}
                        </select>
                    </label>
                </p>
                <p>
                    <label>
                        File (photo, PDF, audio…) <input name="file" type="file" />
                    </label>
                </p>
                <p>
                    <label>
                        or Link <input name="url" type="url" />
                    </label>
                </p>
                <p>
                    <button type="submit" disabled={busy}>
                        {busy ? "Saving…" : "Save to library"}
                    </button>
                </p>
            </form>
        </section>
    );
}

function Collections({ ops, me, setStatus, reload, setView }) {
    const collections = useMemo(() => collectionsView(ops), [ops]);
    const byId = useMemo(() => new Map(ops.map((op) => [op.id, op])), [ops]);
    const [progress, setProgress] = useState("");

    async function takeWithMe(c) {
        // Make sure we have the newest ops from the node, then pull every media file offline.
        try {
            await sync();
        } catch {}
        await reload();
        const needed = mediaHashes(collectionOps(await allOps(), c.id, me));
        await fetchMedia(needed, (i, n) => setProgress(`Downloading ${i}/${n}…`));
        const missing = (await Promise.all(needed.map(hasMedia))).filter((x) => !x).length;
        setProgress("");
        setStatus(missing ? `${missing} file(s) could not be downloaded — try again at the archive.` : `"${c.name}" is ready to use offline.`);
    }

    async function save(c) {
        const file = await buildBundleFile(collectionOps(ops, c.id, me), `${c.name.replace(/[^\w-]+/g, "_")}.osl.json`);
        setStatus(`Collection ${await shareOrDownload(file)}.`);
    }

    return (
        <section>
            <h2>Collections</h2>
            {progress && <p role="status">{progress}</p>}
            {collections.length === 0 && <p>No collections yet. Open an item to start one.</p>}
            {collections.map((c) => (
                <article key={c.id}>
                    <h3>
                        {c.name} <small>by {c.owner === me ? "you" : c.owner}</small>
                    </h3>
                    <ul>
                        {c.items.map((id) =>
                            byId.get(id) ? (
                                <li key={id}>
                                    <a
                                        href={"#" + id}
                                        onClick={(e) => {
                                            e.preventDefault();
                                            setView({ name: "item", id });
                                        }}
                                    >
                                        {byId.get(id).properties.title}
                                    </a>
                                </li>
                            ) : (
                                <li key={id}>
                                    <i>{id} (not on this device yet)</i>
                                </li>
                            ),
                        )}
                    </ul>
                    <p>
                        <button onClick={() => takeWithMe(c)}>Take this collection with me</button>{" "}
                        <button onClick={() => save(c)}>Save / share collection file</button>{" "}
                        {c.owner === me && (
                            <button
                                onClick={async () => {
                                    const name = prompt("Rename collection", c.name);
                                    if (name && name.trim()) {
                                        await addLocalOp({ type: "name-collection", target: c.id, name: name.trim() });
                                        reload();
                                    }
                                }}
                            >
                                Rename
                            </button>
                        )}
                    </p>
                </article>
            ))}
            <h3>Import a collection file</h3>
            <p>
                <input
                    type="file"
                    accept=".json,application/json"
                    onChange={async (e) => {
                        const file = e.currentTarget.files[0];
                        if (!file) return;
                        try {
                            const r = await importBundleFile(file);
                            setStatus(`Imported ${r.ops} operations and ${r.media} file(s).`);
                        } catch (err) {
                            setStatus("Import failed: " + err.message);
                        }
                        e.currentTarget.value = "";
                        reload();
                    }}
                />
            </p>
        </section>
    );
}

function Device({ me, ops, pending, lastSync, persisted, online, reload, setStatus }) {
    const [usage, setUsage] = useState("");
    const [node, setNode] = useState(null);

    async function checkNode() {
        try {
            const res = await fetch(new URL("status", document.baseURI), { cache: "no-store" });
            setNode(await res.json());
        } catch {
            setNode({ error: "node not reachable" });
        }
    }

    function report() {
        return [
            `OSL test report ${new Date().toISOString()}`,
            `device: ${me}`,
            `browser: ${navigator.userAgent}`,
            `installed: ${isStandalone()}`,
            `secure context: ${window.isSecureContext}`,
            `service worker: ${!!(navigator.serviceWorker && navigator.serviceWorker.controller)}`,
            `persistent storage: ${persisted}`,
            `storage: ${usage}`,
            `online: ${online}`,
            `ops on device: ${ops.length}, mine: ${ops.filter((op) => op.author === me).length}, waiting: ${pending.size}`,
            `last sync: ${lastSync || "never"}`,
            node ? `node: ${JSON.stringify({ ops: node.ops, uniqueIds: node.uniqueIds, devices: node.devices, media: node.media, error: node.error })}` : "node: not checked",
        ].join("\n");
    }
    useEffect(() => {
        navigator.storage &&
            navigator.storage.estimate &&
            navigator.storage.estimate().then((e) => setUsage(`${((e.usage || 0) / 1e6).toFixed(1)} MB used of ${((e.quota || 0) / 1e6).toFixed(0)} MB`));
    }, [ops.length]);
    return (
        <section>
            <h2>This device</h2>
            <dl>
                <dt>Device id</dt>
                <dd>{me}</dd>
                <dt>Operations stored</dt>
                <dd>{ops.length}</dd>
                <dt>Waiting to send</dt>
                <dd>{pending.size}</dd>
                <dt>Last sync</dt>
                <dd>{lastSync ? new Date(lastSync).toLocaleString() : "never"}</dd>
                <dt>Network</dt>
                <dd>{online ? "online" : "offline"}</dd>
                <dt>Secure context (HTTPS)</dt>
                <dd>{window.isSecureContext ? "yes" : "NO — offline mode needs HTTPS (or localhost)"}</dd>
                <dt>Service worker</dt>
                <dd>{"serviceWorker" in navigator ? (navigator.serviceWorker.controller ? "active" : "installing") : "not supported"}</dd>
                <dt>Installed</dt>
                <dd>{isStandalone() ? "yes (home screen)" : "no (browser tab)"}</dd>
                <dt>Persistent storage</dt>
                <dd>{persisted === null ? "…" : persisted ? "granted" : "not granted"}</dd>
                <dt>Storage</dt>
                <dd>{usage || "unknown"}</dd>
            </dl>

            <h3>Testing</h3>
            <p>
                <button onClick={checkNode}>Check the node</button>{" "}
                {node &&
                    (node.error ? (
                        node.error
                    ) : (
                        <span>
                            node holds {node.ops} ops ({node.uniqueIds} unique) from {node.devices} device(s), {node.media} file(s)
                            {node.ops === node.uniqueIds ? " — no duplicates" : " — DUPLICATES FOUND"}
                        </span>
                    ))}
            </p>
            <p>
                <button
                    onClick={async () => {
                        const n = await requeueOwnOps();
                        await reload();
                        setStatus(`${n} operation(s) queued to send again. Sync, then Check the node: the count must not grow.`);
                    }}
                >
                    Send everything again
                </button>{" "}
                <small>(checks that repeats make no duplicates)</small>
            </p>
            <p>
                <button
                    onClick={async () => {
                        const text = report();
                        try {
                            await navigator.clipboard.writeText(text);
                            setStatus("Test report copied.");
                        } catch {
                            prompt("Copy this test report:", text);
                        }
                    }}
                >
                    Copy test report
                </button>
            </p>
        </section>
    );
}

const root = document.getElementById("app");
root.textContent = ""; // drop the loading placeholder from index.html
render(<App />, root);
