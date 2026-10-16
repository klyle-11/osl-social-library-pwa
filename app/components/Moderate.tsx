import { useEffect, useState } from "preact/hooks";
import type { ActivityEntry, Ban, Takedown } from "../../adapters/http-transport";
import type { Op } from "../../core/types";
import { attempt, directory, tell, useLibrary, useTransport } from "../state";
import { refreshDirectory } from "../people";
import { when } from "../format";

type Tab = "activity" | "requests" | "bans" | "settings";

// For the library's stewards and admins: everything that reached the library, newest
// first, to strike out, remove, or ban whoever sent it; takedown requests; bans.
export function Moderate() {
    const d = directory.value;
    const roles = d?.library.roles ?? [];
    const [tab, setTab] = useState<Tab>("activity");
    if (!roles.includes("steward")) {
        return <section class="moderate"><h2 class="moderate__title">Moderate</h2><p class="moderate__text">This page is for the library's stewards and admins.</p></section>;
    }
    const admin = roles.includes("admin");
    const tabs: [Tab, string][] = [["activity", "Activity"], ...(admin ? [["requests", "Requests"], ["bans", "Bans"]] as [Tab, string][] : []),
        ...(d?.me?.admin ? [["settings", "Contact"]] as [Tab, string][] : [])];
    return (
        <section class="moderate">
            <h2 class="moderate__title">Moderate <span class="mark">{d!.library.name}</span></h2>
            <div class="moderate__tabs" role="tablist">
                {tabs.map(([t, label]) => (
                    <button class={`moderate__tab${tab === t ? " moderate__tab--on" : ""}`} type="button" role="tab" aria-selected={tab === t} key={t} onClick={() => setTab(t)}>{label}</button>
                ))}
            </div>
            {tab === "activity" && <Activity admin={admin} />}
            {tab === "requests" && admin && <Requests />}
            {tab === "bans" && admin && <Bans />}
            {tab === "settings" && d?.me?.admin && <Contact />}
        </section>
    );
}

const KIND: Record<Op["type"], string> = {
    document: "added", annotation: "wrote", describe: "filled in", "add-to-collection": "collected", "remove-from-collection": "took out of a collection",
    "name-collection": "named a collection", "name-user": "called themselves", hide: "hid", "collection-access": "shared a collection", redact: "took back"
};

// what an op says, in a line
function said(op: Op): string {
    switch (op.type) {
        case "document": return op.properties.title;
        case "annotation": return op.body;
        case "describe": return `${op.field}: ${op.value}`;
        case "name-collection": case "name-user": return op.name;
        case "redact": return op.mode === "strike" ? "struck out" : "removed";
        default: return "";
    }
}

// ops that carry words, and so can be struck out (the rest can only be removed)
const HAS_WORDS = new Set<Op["type"]>(["document", "annotation", "describe", "name-collection", "name-user"]);

function Activity({ admin }: { admin: boolean }) {
    const transport = useTransport();
    const store = useLibrary();
    const [entries, setEntries] = useState<ActivityEntry[]>([]);
    const [next, setNext] = useState(0);
    const [total, setTotal] = useState(0);
    const [banning, setBanning] = useState<ActivityEntry | null>(null);
    const [find, setFind] = useState("");

    const load = (more = false) => attempt(async () => {
        const r = await transport.activity(more ? next : undefined);
        setEntries(more ? [...entries, ...r.entries] : r.entries);
        setNext(r.next);
        setTotal(r.total);
    });
    useEffect(() => { void load(); }, []);

    const takeBack = (e: ActivityEntry, mode: "strike" | "remove") => attempt(async () => {
        const what = mode === "strike" ? "Strike out its words? It stays, with who wrote it, as ***." : "Remove it altogether? An upload's file is deleted from the library.";
        if (!confirm(what)) return;
        await store.redact(e.op.id, mode);
        tell(mode === "strike" ? "Struck out." : "Removed.");
        setTimeout(() => void load(), 1500);   // once it has reached the library
    });

    const q = find.trim().toLowerCase();
    const shown = q ? entries.filter(e => `${e.name} ${e.op.user} ${e.from ?? ""} ${said(e.op)} ${e.about ?? ""}`.toLowerCase().includes(q)) : entries;
    return (
        <div class="moderate__panel">
            <div class="moderate__bar">
                <label class="moderate__find">Find<input type="search" value={find} placeholder="Words, a name, a device, an address" onInput={e => setFind((e.currentTarget as HTMLInputElement).value)} /></label>
                <button class="moderate__quiet" type="button" onClick={() => void load()}>Refresh</button>
            </div>
            <p class="moderate__text">{total} things have reached this library. Newest first.</p>
            {banning && <BanForm entry={banning} done={() => setBanning(null)} />}
            <ol class="moderate__list">
                {shown.map(e => (
                    <li class={`moderate__entry${e.redacted ? ` moderate__entry--${e.redacted}` : ""}`} key={e.op.id}>
                        <p class="moderate__who">
                            <span class="mark">{e.name}</span>{" "}{KIND[e.op.type]}
                            {e.about && <> on <i>{e.about}</i></>}
                            {" · "}<time dateTime={e.op.timestamp}>{when(e.op.timestamp)}</time>
                        </p>
                        {said(e.op) && <p class={`moderate__said${e.redacted === "strike" ? " moderate__said--struck" : ""}`}>{said(e.op)}</p>}
                        <p class="moderate__meta">
                            device <code>{e.op.user}</code>{e.from && <> · from <code>{e.from}</code></>}{e.account && " · signed in"}
                            {e.redacted && <> · <b>{e.redacted === "strike" ? "struck out" : "removed"}</b></>}
                        </p>
                        <p class="moderate__actions">
                            {!e.redacted && e.op.type !== "redact" && HAS_WORDS.has(e.op.type) && e.redacted !== "strike" &&
                                <button class="moderate__act" type="button" onClick={() => takeBack(e, "strike")}>Strike out</button>}
                            {e.redacted !== "remove" && e.op.type !== "redact" &&
                                <button class="moderate__act" type="button" onClick={() => takeBack(e, "remove")}>Remove</button>}
                            {admin && e.op.user !== "steward" && e.op.user !== "folder" &&
                                <button class="moderate__act" type="button" onClick={() => setBanning(e)}>Ban…</button>}
                        </p>
                    </li>
                ))}
            </ol>
            {next > 0 && <button class="moderate__more" type="button" onClick={() => void load(true)}>Older</button>}
        </div>
    );
}

// who to ban for something they sent: their device, their address, their account
function BanForm({ entry, done }: { entry: ActivityEntry | null, done: () => void }) {
    const transport = useTransport();
    const d = directory.value!;
    const [device, setDevice] = useState(entry?.op.user ?? "");
    const [ip, setIp] = useState(entry?.from && entry.from !== "radio" ? entry.from : "");
    const [account, setAccount] = useState(entry?.account ?? "");
    const [byDevice, setByDevice] = useState(true);
    const [byIp, setByIp] = useState(false);
    const [byAccount, setByAccount] = useState(!!entry?.account);
    const [message, setMessage] = useState("");
    const [contact, setContact] = useState(true);
    const [everywhere, setEverywhere] = useState(false);
    const text = (set: (v: string) => void) => (e: Event) => set((e.currentTarget as HTMLInputElement).value);
    return (
        <form class="moderate__ban" onSubmit={e => {
            e.preventDefault();
            attempt(async () => {
                await transport.ban({
                    ...(byDevice && device && { device }), ...(byIp && ip && { ip }), ...(byAccount && account && { account }),
                    message, contact, everywhere
                });
                tell("Banned. They're told at their next sync.");
                done();
            });
        }}>
            <h3 class="moderate__heading">Ban{entry ? ` ${entry.name}` : ""}</h3>
            <label class="moderate__check"><input type="checkbox" checked={byDevice} onChange={e => setByDevice((e.currentTarget as HTMLInputElement).checked)} />
                <span>This device <input class="moderate__inline" value={device} onInput={text(setDevice)} aria-label="Device id" /></span></label>
            <label class="moderate__check"><input type="checkbox" checked={byIp} onChange={e => setByIp((e.currentTarget as HTMLInputElement).checked)} />
                <span>This address <input class="moderate__inline" value={ip} onInput={text(setIp)} aria-label="Address" /> (everyone on it, until it changes)</span></label>
            <label class="moderate__check"><input type="checkbox" checked={byAccount} onChange={e => setByAccount((e.currentTarget as HTMLInputElement).checked)} />
                <span>This account <input class="moderate__inline" value={account} onInput={text(setAccount)} aria-label="Account id" /> (signed out everywhere)</span></label>
            <label class="moderate__field">A message for them (optional)
                <textarea value={message} rows={3} maxLength={1000} onInput={text(setMessage)} placeholder="What they'll see instead of the library" />
            </label>
            <label class="moderate__check"><input type="checkbox" checked={contact} onChange={e => setContact((e.currentTarget as HTMLInputElement).checked)} />
                <span>Send your contact details with it{d.contact ? `: ${d.contact}` : " (none set yet: Contact tab)"}</span></label>
            {d.me?.admin && (
                <label class="moderate__check"><input type="checkbox" checked={everywhere} onChange={e => setEverywhere((e.currentTarget as HTMLInputElement).checked)} />
                    <span>From every library on this node</span></label>
            )}
            <div class="moderate__row">
                <button class="moderate__danger" type="submit" disabled={!(byDevice && device) && !(byIp && ip) && !(byAccount && account)}>Ban</button>
                <button class="moderate__quiet" type="button" onClick={done}>Cancel</button>
            </div>
        </form>
    );
}

function Bans() {
    const transport = useTransport();
    const [bans, setBans] = useState<Ban[] | null>(null);
    const [adding, setAdding] = useState(false);
    const load = () => attempt(async () => setBans((await transport.bans(!!directory.value?.me?.admin)).bans));
    useEffect(() => { void load(); }, []);
    return (
        <div class="moderate__panel">
            <p class="moderate__text">Banned devices, addresses and accounts get nothing of the library and can add nothing. Admins can't be banned.</p>
            {adding ? <BanForm entry={null} done={() => { setAdding(false); void load(); }} />
                : <button class="moderate__quiet" type="button" onClick={() => setAdding(true)}>Ban a device, address or account</button>}
            {bans && !bans.length && <p class="moderate__text">Nobody is banned.</p>}
            <ul class="moderate__list">
                {(bans ?? []).map(b => (
                    <li class="moderate__entry" key={b.id}>
                        <p class="moderate__who">
                            {[b.device && <>device <code>{b.device}</code></>, b.ip && <>address <code>{b.ip}</code></>, b.account && <>account <code>{b.account}</code></>].filter(Boolean)
                                .map((x, i) => <span key={i}>{i > 0 && " · "}{x}</span>)}
                            {" · "}{b.library === "*" ? "every library" : "this library"} · <time dateTime={b.at}>{when(b.at)}</time>
                        </p>
                        {b.message && <p class="moderate__said">“{b.message}”{b.contact && " + contact details"}</p>}
                        <p class="moderate__actions">
                            <button class="moderate__act" type="button" onClick={() => attempt(async () => { await transport.unban(b.id); tell("Ban lifted."); void load(); })}>Lift the ban</button>
                        </p>
                    </li>
                ))}
            </ul>
        </div>
    );
}

function Requests() {
    const transport = useTransport();
    const [list, setList] = useState<Takedown[] | null>(null);
    useEffect(() => { void attempt(async () => setList((await transport.takedowns(!!directory.value?.me?.admin)).takedowns)); }, []);
    if (!list) return <p class="moderate__text">Loading…</p>;
    if (!list.length) return <p class="moderate__text">No takedown requests. They come from the Takedown page.</p>;
    return (
        <ol class="moderate__list">
            {list.map(t => (
                <li class="moderate__entry" key={t.id}>
                    <p class="moderate__who"><b>{t.kind}</b> · <span class="mark">{t.name}</span> · {t.contact} · <time dateTime={t.at}>{when(t.at)}</time></p>
                    {t.work && <p class="moderate__said"><span class="moderate__label">About</span> {t.work}</p>}
                    <p class="moderate__said"><span class="moderate__label">Where</span> {t.where}</p>
                    <p class="moderate__meta">
                        {t.kind === "copyright" && (t.statement ? `statements made, signed “${t.signature}”` : "no statements")}
                        {t.library !== "main" && ` · library ${t.library}`} · from <code>{t.from}</code>
                    </p>
                </li>
            ))}
        </ol>
    );
}

// the node admin's details, written once: shown on the Takedown page, and with bans if chosen
function Contact() {
    const transport = useTransport();
    const [text, setText] = useState(directory.value?.contact ?? "");
    return (
        <form class="moderate__panel" onSubmit={e => {
            e.preventDefault();
            attempt(async () => { await transport.setContact(text); await refreshDirectory(); tell("Saved."); });
        }}>
            <label class="moderate__field">How to reach whoever looks after this node
                <textarea value={text} rows={3} maxLength={1000} placeholder="A name, an email or phone number, where to find you"
                    onInput={e => setText((e.currentTarget as HTMLTextAreaElement).value)} />
            </label>
            <p class="moderate__text">It's shown on the Takedown page, and sent with a ban when you tick it.</p>
            <button class="moderate__save" type="submit">Save</button>
        </form>
    );
}
