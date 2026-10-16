import { useEffect, useState } from "preact/hooks";
import type { Suggestion } from "../../adapters/http-transport";
import { nodeRole, tell, useTransport } from "../state";
import { when } from "../format";

const KINDS: [string, string][] = [
    ["broken", "Something didn't work"], ["confusing", "Something was confusing"],
    ["idea", "An idea or a wish"], ["testing", "Notes from trying it out"], ["other", "Something else"]
];
const PENDING = "osl-suggestions-waiting";
const KEY = "osl-suggestions-key";

// Suggestions waiting on this phone (written at a drop point, or offline). They go
// to the library the next time this page, or the app, can reach it.
function waiting(): Suggestion[] {
    try { return JSON.parse(localStorage.getItem(PENDING) ?? "[]") as Suggestion[]; } catch { return []; }
}
function setWaiting(list: Suggestion[]) {
    try { list.length ? localStorage.setItem(PENDING, JSON.stringify(list)) : localStorage.removeItem(PENDING); } catch { /* nowhere to keep it */ }
}

export async function sendWaitingSuggestions(send: (s: Suggestion) => Promise<void>): Promise<number> {
    const list = waiting();
    let sent = 0;
    for (const s of list) {
        try { await send({ ...s, via: s.via || "waited on the phone" }); sent++; } catch { break; }
    }
    setWaiting(list.slice(sent));
    return sent;
}

// A suggestions box. What's written here goes to the developer alone: not into the
// library, not onto anyone else's phone, not on the big screen.
export function Suggest() {
    const transport = useTransport();
    const [kind, setKind] = useState("idea");
    const [text, setText] = useState("");
    const [contact, setContact] = useState("");
    const [withDevice, setWithDevice] = useState(true);
    const [busy, setBusy] = useState(false);
    const [held, setHeld] = useState(waiting().length);
    const from = (() => { try { return sessionStorage.getItem("osl-last-page") ?? ""; } catch { return ""; } })();

    useEffect(() => {
        if (nodeRole.value !== "library" || !held) return;
        void sendWaitingSuggestions(s => transport.suggest(s)).then(n => { if (n) { setHeld(waiting().length); tell(`${n} waiting suggestion${n === 1 ? "" : "s"} sent.`); } });
    }, []);

    async function submit(e: Event) {
        e.preventDefault();
        if (!text.trim() || busy) return;
        const s: Suggestion = {
            kind, text: text.trim(), contact: contact.trim(), page: from,
            ...(withDevice && { device: `${navigator.userAgent} · screen ${screen.width}×${screen.height} · window ${innerWidth}×${innerHeight}` })
        };
        setBusy(true);
        try {
            // a drop point has no suggestions box: it waits on the phone
            if (nodeRole.value === "droppoint") throw new TypeError("at a drop point");
            await transport.suggest({ ...s, via: "library" });
            tell("Thank you. It went to the developer, and nobody else.");
        } catch (err) {
            if (!(err instanceof TypeError)) { tell(String((err as Error).message ?? err), true); setBusy(false); return; }
            // couldn't reach the library: keep it here and send it later
            setWaiting([...waiting(), { ...s, via: nodeRole.value === "droppoint" ? "drop point" : "offline" }]);
            setHeld(waiting().length);
            tell("Kept on this phone. It'll go to the developer next time you're on the library's Wi-Fi.");
        }
        setText(""); setContact("");
        setBusy(false);
    }

    return (
        <form class="suggest" onSubmit={submit}>
            <h2 class="suggest__title">Suggest</h2>
            <p class="suggest__lead">
                Tell the developer what worked, what didn't, and what you wish it did.
                <strong> Only the developer reads this.</strong> It isn't added to the library and nobody else sees it.
            </p>
            {held > 0 && <p class="suggest__held">{held} suggestion{held === 1 ? " is" : "s are"} waiting on this phone to be sent.</p>}
            <fieldset class="suggest__kinds">
                <legend class="suggest__label">What is it about?</legend>
                {KINDS.map(([value, label]) => (
                    <label class="suggest__kind" key={value}>
                        <input type="radio" name="kind" value={value} checked={kind === value} onChange={() => setKind(value)} /> {label}
                    </label>
                ))}
            </fieldset>
            <label class="suggest__field">
                <span class="suggest__label">{kind === "broken" ? "What were you trying to do, and what happened instead?" : kind === "testing" ? "What did you try, and how did it go?" : "Your suggestion"}</span>
                <textarea class="suggest__text" rows={6} maxLength={5000} value={text} required
                    onInput={e => setText((e.currentTarget as HTMLTextAreaElement).value)} />
            </label>
            <label class="suggest__field">
                <span class="suggest__label">Your name or how to reach you (optional)</span>
                <input class="suggest__contact" maxLength={200} value={contact} onInput={e => setContact((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <label class="suggest__check">
                <input type="checkbox" checked={withDevice} onChange={e => setWithDevice((e.currentTarget as HTMLInputElement).checked)} />
                Include which phone or browser I'm using (helps fix problems)
            </label>
            <button class="suggest__send" type="submit" disabled={busy || !text.trim()}>{busy ? "Sending…" : "Send to the developer"}</button>
        </form>
    );
}

// The developer's side: the box, opened with the key the node prints when it starts.
export function Suggestions() {
    const transport = useTransport();
    const [key, setKey] = useState(() => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } });
    const [draft, setDraft] = useState("");
    const [list, setList] = useState<Awaited<ReturnType<typeof transport.suggestions>> | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!key) return;
        transport.suggestions(key).then(l => { setList(l); setError(null); }, e => { setError(String(e.message ?? e)); setList(null); });
    }, [key]);

    if (!key || error) {
        return (
            <form class="suggest" onSubmit={e => {
                e.preventDefault();
                try { localStorage.setItem(KEY, draft.trim()); } catch { /* this visit only */ }
                setError(null);
                setKey(draft.trim());
            }}>
                <h2 class="suggest__title">Suggestions</h2>
                <p class="suggest__lead">For the developer. The key is printed in the node's console when it starts (“Suggestions: … with the key …”).</p>
                {error && <p class="suggest__error">{error}</p>}
                <label class="suggest__field">
                    <span class="suggest__label">Key</span>
                    <input class="suggest__contact" value={draft} autoComplete="off" onInput={e => setDraft((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="suggest__send" type="submit" disabled={!draft.trim()}>Open the box</button>
            </form>
        );
    }
    return (
        <section class="suggest">
            <h2 class="suggest__title">Suggestions <span class="suggest__count">{list ? list.length : "…"}</span></h2>
            <p class="suggest__lead">Only on this device, with the key. Newest first. Also in <code>data/suggestions.jsonl</code> on the node.
                {" "}<button type="button" class="suggest__lock" onClick={() => { try { localStorage.removeItem(KEY); } catch { /* fine */ } setKey(""); setList(null); }}>Forget the key here</button>
            </p>
            {list && !list.length && <p class="suggest__lead">The box is empty.</p>}
            <ol class="suggest__list">
                {list?.map(s => (
                    <li class={`suggest__item suggest__item--${s.kind}`} key={s.id}>
                        <p class="suggest__meta">
                            <b>{KINDS.find(([k]) => k === s.kind)?.[1] ?? s.kind}</b> · <time dateTime={s.receivedAt}>{when(s.receivedAt)}</time>
                            {s.contact && <> · from {s.contact}</>}
                            {s.via && s.via !== "library" && <> · {s.via}</>}
                        </p>
                        <p class="suggest__body">{s.text}</p>
                        {(s.page || s.device || s.app) && <p class="suggest__device">{[s.page && `on ${s.page}`, s.app && `app ${s.app}`, s.device].filter(Boolean).join(" · ")}</p>}
                    </li>
                ))}
            </ol>
        </section>
    );
}
