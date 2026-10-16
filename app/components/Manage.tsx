import { useEffect, useState } from "preact/hooks";
import type { AccountInfo, Directory, Group, LibraryRole, Uploader } from "../../adapters/http-transport";
import { attempt, directory, tell, useTransport } from "../state";
import { MAIN, libraryId, switchTo } from "../library";
import { refreshDirectory } from "../people";
import { href } from "../route";

export const UPLOAD_CHOICES: [Uploader, string][] = [
    ["guests", "Anyone, guests too"],
    ["accounts", "Anyone signed in"],
    ["members", "Anyone with a role here"],
    ["uploaders", "Uploaders"],
    ["digitizers", "Digitizers (and the paired digitization station)"],
    ["presenters", "Presenters (and paired presenters)"]
];

const ROLE_CHOICES: [LibraryRole, string, string][] = [
    ["admin", "Admin", "this page: settings, password, roles, groups"],
    ["steward", "Steward", "hides anyone's contributions, edits any details"],
    ["presenter", "Presenter", "puts documents on the big screen"],
    ["digitizer", "Digitizer", "uploads scans at full size"],
    ["uploader", "Uploader", "adds documents when uploaders may"],
    ["member", "Member", "opens it without the password"]
];

// For this library's admins (and the node admin): who may do what here (W-D12).
export function Manage() {
    const transport = useTransport();
    const d = directory.value;
    const [people, setPeople] = useState<AccountInfo[] | null>(null);
    const [signup, setSignup] = useState<boolean | undefined>(undefined);
    const admin = !!d?.library.roles?.includes("admin");

    const load = () => attempt(async () => {
        const r = await transport.accounts();
        setPeople(r.accounts);
        setSignup(r.signup);
    });
    useEffect(() => { if (admin) void load(); }, [admin]);

    if (!d) return <section class="manage"><h2 class="manage__title">Manage</h2><p class="manage__text">Connect to the library first.</p></section>;
    if (!admin) {
        return (
            <section class="manage">
                <h2 class="manage__title">Manage</h2>
                <p class="manage__text">This page is for the library's admins. <a href={href({ view: "account" })}>Sign in</a> if you are one.</p>
            </section>
        );
    }
    // every change answers with the directory as it stands; asking again keeps the device's copy in step
    const saved = async (_next: Directory | void, message: string) => {
        await refreshDirectory();
        tell(message);
    };

    return (
        <section class="manage">
            <h2 class="manage__title">Manage <span class="mark">{d.library.name}</span></h2>
            <p class="manage__text">Changes here apply on every device, the next time each one syncs.</p>
            <Settings saved={saved} />
            <Password saved={saved} />
            <Uploaders saved={saved} />
            {d.me?.admin && <Watch saved={saved} />}
            <Roles people={people} saved={saved} />
            <Groups people={people} saved={saved} />
            {d.me?.admin && <Node people={people} signup={signup} reload={load} />}
            {d.me?.admin && libraryId !== MAIN && <Delete />}
        </section>
    );
}

type Saved = (next: Directory | void, message: string) => Promise<void>;

function Settings({ saved }: { saved: Saved }) {
    const transport = useTransport();
    const d = directory.value!;
    const [name, setName] = useState(d.library.name);
    return (
        <form class="manage__section" onSubmit={e => { e.preventDefault(); attempt(async () => saved(await transport.librarySettings({ name }), "Name saved.")); }}>
            <h3 class="manage__heading">Name</h3>
            <label class="manage__field">What everyone sees
                <input value={name} maxLength={80} required onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <button class="manage__save" type="submit">Save</button>
        </form>
    );
}

function Password({ saved }: { saved: Saved }) {
    const transport = useTransport();
    const d = directory.value!;
    const [password, setPassword] = useState("");
    const on = d.library.protected;
    return (
        <form class="manage__section" onSubmit={e => {
            e.preventDefault();
            attempt(async () => { await saved(await transport.librarySettings({ password }), on ? "Password changed." : "The library is protected."); setPassword(""); });
        }}>
            <h3 class="manage__heading">Password</h3>
            <p class="manage__text">
                {on
                    ? "Protected: people need the password, a role here, or to look after the node. Changing it closes the library on every device that opened it with the old one."
                    : "Open: anyone who reaches the library can open it."}
                {" "}A phone that has opened it keeps what it has.
            </p>
            <label class="manage__field">{on ? "New password" : "Password"} (at least 4 characters)
                <input type="password" value={password} minLength={4} required autocomplete="new-password" onInput={e => setPassword((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <div class="manage__row">
                <button class="manage__save" type="submit">{on ? "Change it" : "Protect it"}</button>
                {on && (
                    <button class="manage__quiet" type="button" onClick={() => {
                        if (confirm("Open this library to everyone?")) attempt(async () => saved(await transport.librarySettings({ password: null }), "The library is open to everyone."));
                    }}>Remove the password</button>
                )}
            </div>
        </form>
    );
}

function Uploaders({ saved }: { saved: Saved }) {
    const transport = useTransport();
    const d = directory.value!;
    const [upload, setUpload] = useState<Uploader[]>(d.library.upload ?? ["guests"]);
    const changed = [...upload].sort().join() !== [...(d.library.upload ?? [])].sort().join();
    return (
        <form class="manage__section" onSubmit={e => { e.preventDefault(); attempt(async () => saved(await transport.librarySettings({ upload }), "Saved who may add documents.")); }}>
            <fieldset class="manage__choices">
                <legend class="manage__heading">Who may add documents</legend>
                <p class="manage__text">Any combination. Admins and stewards always may. Checked at the library, so it holds for what comes by radio too.</p>
                {UPLOAD_CHOICES.map(([value, label]) => (
                    <label class="manage__check" key={value}>
                        <input type="checkbox" checked={upload.includes(value)}
                            onChange={e => setUpload((e.currentTarget as HTMLInputElement).checked ? [...upload, value] : upload.filter(u => u !== value))} />
                        <span>{label}</span>
                    </label>
                ))}
                {!upload.length && <p class="manage__text manage__warn">Nobody checked: only admins and stewards may add documents.</p>}
            </fieldset>
            <button class="manage__save" type="submit" disabled={!changed}>Save</button>
        </form>
    );
}

function Watch({ saved }: { saved: Saved }) {
    const transport = useTransport();
    const d = directory.value!;
    const [folder, setFolder] = useState(d.library.watch?.folder ?? "");
    return (
        <form class="manage__section" onSubmit={e => {
            e.preventDefault();
            attempt(async () => saved(await transport.librarySettings({ watch: folder.trim() || null }), folder.trim() ? "Watching the folder." : "Not watching a folder."));
        }}>
            <h3 class="manage__heading">Watch folder</h3>
            <p class="manage__text">
                A folder on the node. Files put in it become documents here, titled from their names and added by the library.
                It's looked at when it changes and every minute; a file taken out stays in the library.
            </p>
            <label class="manage__field">Full path on the node (empty: none)
                <input value={folder} placeholder="/home/pi/scans" spellcheck={false} autocapitalize="none" onInput={e => setFolder((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <button class="manage__save" type="submit">Save</button>
        </form>
    );
}

function Roles({ people, saved }: { people: AccountInfo[] | null, saved: Saved }) {
    const transport = useTransport();
    const d = directory.value!;
    const roles = d.roles ?? {};
    const [find, setFind] = useState("");
    if (!people) return <section class="manage__section"><h3 class="manage__heading">People and roles</h3><p class="manage__text">Loading…</p></section>;
    const q = find.trim().toLowerCase();
    // people with a role here, then whoever the search finds
    const shown = people.filter(a => roles[a.id] || (q && (a.username.includes(q) || a.name.toLowerCase().includes(q))));
    const toggle = (a: AccountInfo, role: LibraryRole, on: boolean) => {
        const now = roles[a.id] ?? [];
        const next = on ? [...now, role] : now.filter(r => r !== role);
        attempt(async () => saved(await transport.setRoles(a.id, next), `${a.name}: ${next.length ? next.join(", ") : "no role"} here.`));
    };
    return (
        <section class="manage__section">
            <h3 class="manage__heading">People and roles</h3>
            <ul class="manage__legend">
                {ROLE_CHOICES.map(([r, label, what]) => <li key={r}><b>{label}</b>: {what}</li>)}
            </ul>
            <label class="manage__field">Find someone with an account
                <input type="search" value={find} placeholder="Name or username" onInput={e => setFind((e.currentTarget as HTMLInputElement).value)} />
            </label>
            {shown.length ? (
                <ul class="manage__people">
                    {shown.map(a => (
                        <li class="manage__person" key={a.id}>
                            <span class="manage__person-name"><span class="mark">{a.name}</span> <code>{a.username}</code>{a.admin && " · looks after the node"}</span>
                            <span class="manage__roles">
                                {ROLE_CHOICES.map(([r, label]) => (
                                    <label class="manage__role" key={r}>
                                        <input type="checkbox" checked={(roles[a.id] ?? []).includes(r)} onChange={e => toggle(a, r, (e.currentTarget as HTMLInputElement).checked)} />
                                        <span>{label}</span>
                                    </label>
                                ))}
                            </span>
                        </li>
                    ))}
                </ul>
            ) : <p class="manage__text">{q ? "No account matches." : "Nobody has a role here yet. Find someone above."}</p>}
        </section>
    );
}

function Groups({ people, saved }: { people: AccountInfo[] | null, saved: Saved }) {
    const transport = useTransport();
    const d = directory.value!;
    const [name, setName] = useState("");
    const groups = d.groups ?? [];
    const save = (g: Partial<Group> & { delete?: boolean }, message: string) => attempt(async () => saved(await transport.saveGroup(g), message));
    const nameOf = (id: string) => people?.find(a => a.id === id)?.name ?? d.accounts?.[id] ?? "Someone";
    return (
        <section class="manage__section">
            <h3 class="manage__heading">Groups</h3>
            <p class="manage__text">Named sets of people with accounts. Collections can be shared with a group.</p>
            <ul class="manage__groups">
                {groups.map(g => (
                    <li class="manage__group" key={g.id}>
                        <span class="manage__group-name">{g.name}</span>
                        <ul class="manage__members">
                            {g.members.map(m => (
                                <li class="manage__member" key={m}>
                                    {nameOf(m)}
                                    <button class="manage__small" type="button" aria-label={`Take ${nameOf(m)} out of ${g.name}`}
                                        onClick={() => save({ id: g.id, members: g.members.filter(x => x !== m) }, `${nameOf(m)} is out of ${g.name}.`)}>×</button>
                                </li>
                            ))}
                        </ul>
                        {people && (
                            <select class="manage__add-member" value="" aria-label={`Add someone to ${g.name}`}
                                onChange={e => {
                                    const id = (e.currentTarget as HTMLSelectElement).value;
                                    if (id) save({ id: g.id, members: [...g.members, id] }, `${nameOf(id)} is in ${g.name}.`);
                                }}>
                                <option value="">Add someone…</option>
                                {people.filter(a => !g.members.includes(a.id)).map(a => <option value={a.id} key={a.id}>{a.name} ({a.username})</option>)}
                            </select>
                        )}
                        <button class="manage__quiet" type="button" onClick={() => { if (confirm(`Delete the group ${g.name}?`)) save({ id: g.id, delete: true }, `${g.name} is deleted.`); }}>Delete group</button>
                    </li>
                ))}
            </ul>
            <form class="manage__row" onSubmit={e => { e.preventDefault(); if (name.trim()) { save({ name }, `${name} is made.`); setName(""); } }}>
                <label class="manage__field">New group
                    <input value={name} maxLength={80} placeholder="Reading circle" onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="manage__save" type="submit">Make it</button>
            </form>
        </section>
    );
}

// For whoever looks after the node: everyone's accounts.
function Node({ people, signup, reload }: { people: AccountInfo[] | null, signup: boolean | undefined, reload: () => Promise<unknown> }) {
    const transport = useTransport();
    const [username, setUsername] = useState("");
    const [name, setName] = useState("");
    const [password, setPassword] = useState("");
    const change = (a: AccountInfo, changes: Parameters<typeof transport.changeAccount>[1], message: string) =>
        attempt(async () => { await transport.changeAccount(a.id, changes); await reload(); tell(message); });
    return (
        <section class="manage__section">
            <h3 class="manage__heading">Accounts on this node</h3>
            <label class="manage__check">
                <input type="checkbox" checked={!!signup} onChange={e => attempt(async () => { await transport.setSignup((e.currentTarget as HTMLInputElement).checked); await reload(); })} />
                <span>Anyone may make an account</span>
            </label>
            <ul class="manage__people">
                {(people ?? []).map(a => (
                    <li class="manage__person" key={a.id}>
                        <span class="manage__person-name">
                            <span class="mark">{a.name}</span> <code>{a.username}</code>
                            {a.admin && " · looks after the node"}{a.disabled && " · turned off"}
                            {a.devices !== undefined && ` · ${a.devices} device${a.devices === 1 ? "" : "s"}`}
                        </span>
                        <span class="manage__row">
                            <button class="manage__quiet" type="button" onClick={() => change(a, { admin: !a.admin }, a.admin ? `${a.name} no longer looks after the node.` : `${a.name} looks after the node too.`)}>
                                {a.admin ? "Not node admin" : "Make node admin"}
                            </button>
                            <button class="manage__quiet" type="button" onClick={() => change(a, { disabled: !a.disabled }, a.disabled ? `${a.name} can sign in again.` : `${a.name} is signed out everywhere and can't sign in.`)}>
                                {a.disabled ? "Turn on" : "Turn off"}
                            </button>
                            <button class="manage__quiet" type="button" onClick={() => {
                                const pw = prompt(`A new password for ${a.name} (at least 8 characters). They'll be signed out everywhere.`);
                                if (pw) change(a, { password: pw }, `${a.name}'s password is changed.`);
                            }}>New password</button>
                        </span>
                    </li>
                ))}
            </ul>
            <form class="manage__section manage__new-account" onSubmit={e => {
                e.preventDefault();
                attempt(async () => {
                    await transport.signUp({ username, name, password, signIn: false });
                    setUsername(""); setName(""); setPassword("");
                    await reload();
                    tell(`${name || username} has an account. Give them the password; they can change it.`);
                });
            }}>
                <h4 class="manage__heading">Make an account for someone</h4>
                <label class="manage__field">Username
                    <input value={username} required maxLength={32} autocapitalize="none" spellcheck={false} autocomplete="off" onInput={e => setUsername((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="manage__field">Their name
                    <input value={name} maxLength={80} autocomplete="off" onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="manage__field">A first password (at least 8 characters)
                    <input type="text" value={password} required minLength={8} autocomplete="off" onInput={e => setPassword((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="manage__save" type="submit">Make it</button>
            </form>
        </section>
    );
}

function Delete() {
    const transport = useTransport();
    const d = directory.value!;
    const [typed, setTyped] = useState("");
    return (
        <form class="manage__section manage__danger" onSubmit={e => {
            e.preventDefault();
            if (typed !== d.library.id) return;
            attempt(async () => { await transport.deleteLibrary(); switchTo(MAIN); });
        }}>
            <h3 class="manage__heading">Delete this library</h3>
            <p class="manage__text">Its folder on the node is moved aside, not erased, and its name in addresses is never used again. Phones keep what they have.</p>
            <label class="manage__field">Type <code>{d.library.id}</code> to delete it
                <input value={typed} autocapitalize="none" spellcheck={false} onInput={e => setTyped((e.currentTarget as HTMLInputElement).value)} />
            </label>
            <button class="manage__delete" type="submit" disabled={typed !== d.library.id}>Delete {d.library.name}</button>
        </form>
    );
}
