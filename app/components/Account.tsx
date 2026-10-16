import { useState } from "preact/hooks";
import { attempt, directory, signedOut, tell, useLibrary, useTransport, views, viewer } from "../state";
import { guestWork, refreshDirectory, signIn, signOut, signUp } from "../people";
import { href } from "../route";

// An account is optional: one per node, the same in every library here (W-D12).
// Without one, people are guests, and their names show with "(Guest)".
export function Account() {
    const d = directory.value;
    if (!d) return <section class="account"><h2 class="account__title">Account</h2><p class="account__text">Connect to the library to sign in.</p></section>;
    return (
        <section class="account">
            <h2 class="account__title">Account</h2>
            {d.me ? <SignedIn /> : <SignedOutForms />}
        </section>
    );
}

function SignedIn() {
    const store = useLibrary();
    const transport = useTransport();
    const me = directory.value!.me!;
    const [name, setName] = useState(me.name);
    const [current, setCurrent] = useState("");
    const [next, setNext] = useState("");

    return (
        <>
            <p class="account__text">
                Signed in as <span class="mark">{me.name}</span> (<code>{me.username}</code>){me.admin && " · you look after this node"}.
                What you add on this device is yours on every device you sign in on.
            </p>
            <div class="account__row">
                <button class="account__quiet" type="button" onClick={() => attempt(async () => { await signOut(store, transport); tell("Signed out. This device is a guest again."); })}>Sign out</button>
                {directory.value!.library.roles?.includes("admin") && <a class="account__link" href={href({ view: "manage" })}>Manage this library</a>}
            </div>

            <form class="account__form" onSubmit={e => {
                e.preventDefault();
                attempt(async () => { await transport.updateAccount({ name }); await refreshDirectory(); tell("Name saved."); });
            }}>
                <h3 class="account__heading">Your name</h3>
                <label class="account__field">Shown to everyone
                    <input value={name} maxLength={80} required onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="account__save" type="submit">Save</button>
            </form>

            <form class="account__form" onSubmit={e => {
                e.preventDefault();
                attempt(async () => {
                    await transport.updateAccount({ password: next, current });
                    setCurrent(""); setNext("");
                    tell("Password changed. Other devices signed in as you will need it.");
                    await refreshDirectory();
                });
            }}>
                <h3 class="account__heading">Password</h3>
                <label class="account__field">Current password
                    <input type="password" value={current} autocomplete="current-password" required onInput={e => setCurrent((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="account__field">New password (at least 8 characters)
                    <input type="password" value={next} autocomplete="new-password" minLength={8} required onInput={e => setNext((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="account__save" type="submit">Change it</button>
            </form>
        </>
    );
}

function SignedOutForms() {
    const store = useLibrary();
    const transport = useTransport();
    const d = directory.value!;
    const v = views.value;
    const me = viewer.value;
    const made = guestWork(store);
    const [mode, setMode] = useState<"in" | "up">(d.setup ? "up" : "in");
    const [username, setUsername] = useState("");
    const [name, setName] = useState(v.names[me] ?? "");
    const [password, setPassword] = useState("");
    const [code, setCode] = useState("");
    const [keep, setKeep] = useState(true);
    const [busy, setBusy] = useState(false);
    const canSignUp = d.setup || d.signup;

    const go = (e: Event) => {
        e.preventDefault();
        if (busy) return;
        setBusy(true);
        void attempt(async () => {
            if (mode === "in") await signIn(store, transport, username, password, keep);
            else await signUp(store, transport, { username, name, password, ...(d.setup && { code }) }, keep);
            setPassword("");
            tell(mode === "in" ? "Signed in." : d.setup ? "Account made. You look after this node." : "Account made, and you're signed in.");
        }).finally(() => setBusy(false));
    };

    return (
        <>
            {signedOut.value && (
                <p class="account__text account__text--warning">
                    This device was signed in to an account. Sign in again to send what it has waiting; until then it stays here.
                </p>
            )}
            <p class="account__text">
                You don't need an account: as a guest your name shows with "(Guest)". With one, your name, collections
                and roles follow you to every device you sign in on, in every library on this node.
            </p>
            {canSignUp && (
                <div class="account__tabs" role="tablist">
                    <button class={`account__tab${mode === "in" ? " account__tab--on" : ""}`} type="button" role="tab" aria-selected={mode === "in"} onClick={() => setMode("in")}>Sign in</button>
                    <button class={`account__tab${mode === "up" ? " account__tab--on" : ""}`} type="button" role="tab" aria-selected={mode === "up"} onClick={() => setMode("up")}>Make an account</button>
                </div>
            )}
            <form class="account__form" onSubmit={go}>
                {mode === "up" && d.setup && (
                    <p class="account__text">
                        This node has no accounts yet. The first one looks after it: it makes libraries and decides who runs them.
                        It needs the pairing code shown on the library's own screen.
                    </p>
                )}
                <label class="account__field">Username
                    <input value={username} autocomplete="username" autocapitalize="none" spellcheck={false} required maxLength={32}
                        onInput={e => setUsername((e.currentTarget as HTMLInputElement).value)} />
                </label>
                {mode === "up" && (
                    <label class="account__field">Your name, as others see it
                        <input value={name} maxLength={80} autocomplete="name" onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                    </label>
                )}
                <label class="account__field">Password{mode === "up" && " (at least 8 characters)"}
                    <input type="password" value={password} required minLength={mode === "up" ? 8 : undefined}
                        autocomplete={mode === "up" ? "new-password" : "current-password"}
                        onInput={e => setPassword((e.currentTarget as HTMLInputElement).value)} />
                </label>
                {mode === "up" && d.setup && (
                    <label class="account__field">Pairing code
                        <input value={code} inputMode="numeric" autocomplete="off" required maxLength={12} onInput={e => setCode((e.currentTarget as HTMLInputElement).value)} />
                    </label>
                )}
                {made > 0 && (
                    <label class="account__check">
                        <input type="checkbox" checked={keep} onChange={e => setKeep((e.currentTarget as HTMLInputElement).checked)} />
                        <span>What I added on this device as a guest ({made}) becomes my account's. Leave this off on a shared device.</span>
                    </label>
                )}
                <button class="account__save" type="submit" disabled={busy}>{busy ? "…" : mode === "in" ? "Sign in" : "Make my account"}</button>
            </form>
            {!canSignUp && <p class="account__text account__muted">Accounts here are made by whoever looks after the node.</p>}
        </>
    );
}
