import { useEffect, useState } from "preact/hooks";
import type { Role } from "../../adapters/http-transport";
import { remember } from "../../adapters/device";
import { attempt, syncState, tell, tokens, useLibrary, useTransport, views, viewer } from "../state";
import { href } from "../route";
import { canCarry, carried } from "../../adapters/carry";
import { fileUrl } from "../format";
import { THEMES, theme } from "../theme";

// Name (optional), taking the library home, and saving your work as a file.
export function You() {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const [name, setName] = useState(v.names[me] ?? "");
    const mineCount = store.ops.filter(o => o.user === me).length;

    return (
        <section class="you">
            <h2 class="you__title">You</h2>

            <form class="you__name" onSubmit={e => {
                e.preventDefault();
                if (!name.trim()) return;
                attempt(async () => { await store.setName(name); tell("Name saved."); });
            }}>
                <label class="you__name-label">
                    Your name (optional — you can stay a guest)
                    <input class="you__name-input" value={name} maxLength={80}
                        onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="you__name-save" type="submit">Save</button>
            </form>

            <section class="you__section">
                <h3 class="you__heading">Take it with you</h3>
                <InstallHelp />
                <CarryStatus />
            </section>

            <section class="you__section">
                <h3 class="you__heading">Save my work</h3>
                <p class="you__text">
                    You've made {mineCount} contribution{mineCount === 1 ? "" : "s"} on this phone.
                    Save them as a file (to Files, AirDrop, or email) so they're never lost, or to hand them in without a connection.
                </p>
                <button class="you__button" type="button" onClick={() => attempt(async () => saveBundle(await store.exportBundle()))}>Save my work</button>
                <label class="you__import">
                    Load a saved file
                    <input class="you__import-input" type="file" accept=".json,application/json" onChange={e => {
                        const file = (e.currentTarget as HTMLInputElement).files?.[0];
                        if (file) attempt(async () => {
                            const r = await store.importBundle(JSON.parse(await file.text()));
                            tell(`Loaded ${r.added} new contribution${r.added === 1 ? "" : "s"}${r.rejected ? `, skipped ${r.rejected} invalid` : ""}.`);
                        });
                    }} />
                </label>
            </section>

            <Appearance />

            <Pairing />

            <section class="you__section you__section--details">
                <h3 class="you__heading">Details</h3>
                <dl class="you__details">
                    <dt class="you__term">Device id</dt><dd class="you__value"><code>{me}</code></dd>
                    <dt class="you__term">Connection</dt><dd class="you__value">{syncState.value}</dd>
                    <dt class="you__term">Secure (can work offline)</dt><dd class="you__value">{isSecureContext ? "yes" : "no"}</dd>
                    <dt class="you__term">Conflicts</dt><dd class="you__value">{store.conflicts.length}</dd>
                    <dt class="you__term">Ops on this phone</dt><dd class="you__value">{store.ops.length}</dd>
                </dl>
            </section>
        </section>
    );
}

function InstallHelp() {
    const installed = matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (!isSecureContext) {
        return <p class="you__text you__text--warning">
            This address isn't secure (http), so the library can't be saved to your phone for offline use.
            It works while you're here on the Wi-Fi. Ask the host for the https address.
        </p>;
    }
    if (installed) return <p class="you__text">It's on your home screen. It opens and works without a connection.</p>;
    return (
        <div class="you__install">
            <p class="you__text">Add the library to your home screen so it's yours offline:</p>
            <ul class="you__steps">
                <li class="you__step"><b>iPhone:</b> tap the Share button in Safari, then "Add to Home Screen".</li>
                <li class="you__step"><b>Android:</b> tap the ⋮ menu in Chrome, then "Install app" or "Add to Home screen".</li>
            </ul>
        </div>
    );
}

function CarryStatus() {
    const v = views.value;
    const me = viewer.value;
    const urls = new Set<string>();
    for (const c of Object.values(v.collections)) {
        if (c.owner !== me) continue;
        for (const id of c.documentIds) {
            const d = v.documents[id];
            const u = d && fileUrl(d);
            if (u) urls.add(u);
        }
    }
    const [count, setCount] = useState<number | null>(null);
    const key = [...urls].sort().join("\n");
    useEffect(() => {
        let live = true;
        Promise.all([...urls].map(carried)).then(r => { if (live) setCount(r.filter(Boolean).length); });
        return () => { live = false; };
    }, [key]);

    if (!canCarry()) return null;
    if (!urls.size) return <p class="you__text">Keep documents or add them to your collections, and their files come with you.</p>;
    return <p class="you__text">{count ?? "…"} of {urls.size} files from your collections are saved on this phone.</p>;
}

async function saveBundle(bundle: unknown) {
    const text = JSON.stringify(bundle, null, 1);
    const name = `osl-my-work-${new Date().toISOString().slice(0, 10)}.json`;
    const file = new File([text], name, { type: "application/json" });
    // the share sheet is the friendliest route on phones; download everywhere else
    if (navigator.canShare?.({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: "My OSL work" });
            return;
        } catch (e) {
            if (e instanceof DOMException && e.name === "AbortError") return;
        }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}

// A code shown on the library's own screen turns this device into the presenter
// (chooses what's on the big screen) or the digitization station (uploads files).
function Pairing() {
    const transport = useTransport();
    const [code, setCode] = useState("");
    const [role, setRole] = useState<Role>("presenter");
    const held = tokens.value;

    const set = (r: Role, token: string | null) => {
        remember("token:" + r, token);
        const next = { ...tokens.value };
        if (token) next[r] = token; else delete next[r];
        tokens.value = next;
    };

    return (
        <section class="you__section">
            <h3 class="you__heading">Pair this device</h3>
            <p class="you__text">
                For whoever is running the session. Enter the pairing code from the library's own screen.
            </p>
            <form class="you__pair" onSubmit={e => {
                e.preventDefault();
                if (!code.trim()) return;
                attempt(async () => {
                    set(role, await transport.pair(code, role));
                    setCode("");
                    tell(role === "presenter" ? "Paired. This device can now choose what's on the screen." : "Paired. This computer is now the digitization station.");
                });
            }}>
                <label class="you__pair-label">
                    Pairing code
                    <input class="you__pair-input" value={code} inputMode="numeric" autocomplete="off" maxLength={12}
                        onInput={e => setCode((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="you__pair-label">
                    Pair as
                    <select class="you__pair-input" value={role} onChange={e => setRole((e.currentTarget as HTMLSelectElement).value as Role)}>
                        <option value="presenter">Presenter (the big screen)</option>
                        <option value="station">Digitization station (uploads)</option>
                    </select>
                </label>
                <button class="you__button" type="submit">Pair</button>
            </form>
            {held.presenter && (
                <p class="you__text you__paired">
                    This device can present. <a href={href({ view: "present" })}>Open the screen view</a>{" "}
                    <button class="you__unpair" type="button" onClick={() => set("presenter", null)}>Unpair</button>
                </p>
            )}
            {held.station && (
                <p class="you__text you__paired">
                    This computer is the digitization station. <a href={href({ view: "add" })}>Upload a file</a>{" "}
                    <button class="you__unpair" type="button" onClick={() => set("station", null)}>Unpair</button>
                </p>
            )}
        </section>
    );
}

// Colours for this device only. Each choice is drawn in its own colours.
function Appearance() {
    return (
        <section class="you__section">
            <fieldset class="theme-picker">
                <legend class="you__heading theme-picker__legend">Appearance</legend>
                <div class="theme-picker__list">
                    {THEMES.map(t => (
                        <label class="theme-picker__option" key={t.id}>
                            <input class="theme-picker__input" type="radio" name="theme" value={t.id}
                                checked={theme.value === t.id} onChange={() => { theme.value = t.id; }} />
                            <span class="theme-picker__swatch" style={{ background: t.bg, color: t.ink, borderColor: t.ink }}>
                                <span class="theme-picker__name">{t.name}</span>
                                <span class="theme-picker__note">{t.note}</span>
                                <span class="theme-picker__ink" aria-hidden="true">
                                    {t.dots.map(c => <span class="theme-picker__dot" key={c} style={{ background: c }} />)}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            </fieldset>
        </section>
    );
}
