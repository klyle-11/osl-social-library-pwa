import { useState } from "preact/hooks";
import type { Uploader } from "../../adapters/http-transport";
import { attempt, directory, tell, useTransport } from "../state";
import { libraryId, switchTo } from "../library";
import { refreshDirectory } from "../people";
import { UPLOAD_CHOICES } from "./Manage";

// Every library on this node. Each keeps its own notes, collections and people's roles,
// and its own storage on this device: moving to another reloads the page.
export function Libraries() {
    const d = directory.value;
    if (!d) return <section class="libraries"><h2 class="libraries__title">Libraries</h2><p class="libraries__text">Connect to the library to see the others on this node.</p></section>;
    return (
        <section class="libraries">
            <h2 class="libraries__title">Libraries</h2>
            <p class="libraries__text">Each library here has its own documents, notes and collections. A protected one asks for its password once on each device.</p>
            <ul class="libraries__list">
                {d.libraries.map(l => (
                    <li class={`libraries__item${l.id === libraryId ? " libraries__item--here" : ""}`} key={l.id}>
                        <span class="libraries__name">{l.name}</span>
                        <span class="libraries__meta">
                            {l.protected ? (l.open ? "Protected · open on this device" : "Protected · needs its password") : "Open to everyone"}
                        </span>
                        {l.id === libraryId
                            ? <span class="libraries__here">You're here</span>
                            : <button class="libraries__go" type="button" onClick={() => switchTo(l.id)}>Go to {l.name}</button>}
                    </li>
                ))}
            </ul>
            {d.me?.admin && <NewLibrary />}
        </section>
    );
}

const slug = (name: string) => name.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32);

function NewLibrary() {
    const transport = useTransport();
    const [name, setName] = useState("");
    const [id, setId] = useState("");
    const [edited, setEdited] = useState(false);
    const [password, setPassword] = useState("");
    const [upload, setUpload] = useState<Uploader[]>(["guests"]);

    return (
        <form class="libraries__new" onSubmit={e => {
            e.preventDefault();
            attempt(async () => {
                const made = await transport.createLibrary({ id: id || slug(name), name, ...(password && { password }), upload });
                await refreshDirectory();
                tell(`${name} is made.`);
                setName(""); setId(""); setEdited(false); setPassword("");
                if (confirm(`Go to ${name} now?`)) switchTo(made);
            });
        }}>
            <h3 class="libraries__heading">Make a library</h3>
            <label class="libraries__field">Name
                <input value={name} maxLength={80} required onInput={e => {
                    const v = (e.currentTarget as HTMLInputElement).value;
                    setName(v);
                    if (!edited) setId(slug(v));
                }} />
            </label>
            <label class="libraries__field">In its address (<code>?library=…</code>; it can't change later)
                <input value={id} maxLength={32} pattern={"[a-z0-9]([a-z0-9\\-]*[a-z0-9])?"} required autocapitalize="none" spellcheck={false}
                    onInput={e => { setId((e.currentTarget as HTMLInputElement).value); setEdited(true); }} />
            </label>
            <label class="libraries__field">Password (optional; you can add or change it later)
                <input type="password" value={password} autocomplete="new-password" minLength={4} onInput={e => setPassword((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <fieldset class="libraries__who">
                <legend class="libraries__legend">Who may add documents</legend>
                {UPLOAD_CHOICES.map(([value, label]) => (
                    <label class="libraries__check" key={value}>
                        <input type="checkbox" checked={upload.includes(value)}
                            onChange={e => setUpload((e.currentTarget as HTMLInputElement).checked ? [...upload, value] : upload.filter(u => u !== value))} />
                        <span>{label}</span>
                    </label>
                ))}
            </fieldset>
            <button class="libraries__make" type="submit">Make it</button>
        </form>
    );
}
