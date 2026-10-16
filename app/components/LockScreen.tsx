import { useState } from "preact/hooks";
import { attempt, directory, tell, useTransport } from "../state";
import { unlock } from "../people";
import { href } from "../route";

// A protected library, before its password: nothing of it shows (W-D12).
export function LockScreen() {
    const transport = useTransport();
    const d = directory.value;
    const [password, setPassword] = useState("");
    const [busy, setBusy] = useState(false);
    const name = d?.library.name ?? "This library";

    return (
        <section class="lock-screen" aria-labelledby="lock-title">
            <p class="lock-screen__label">Protected library</p>
            <h2 class="lock-screen__title" id="lock-title">{name}</h2>
            <p class="lock-screen__text">Enter its password to open it on this device. People with a role in it can sign in instead.</p>
            <form class="lock-screen__form" onSubmit={e => {
                e.preventDefault();
                if (!password || busy) return;
                setBusy(true);
                void attempt(async () => {
                    await unlock(transport, password);
                    setPassword("");
                    tell(`${name} is open on this device.`);
                }).finally(() => setBusy(false));
            }}>
                <label class="lock-screen__field">
                    Password
                    <input class="lock-screen__input" type="password" value={password} autocomplete="current-password" required
                        onInput={e => setPassword((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="lock-screen__open" type="submit" disabled={busy}>{busy ? "Checking…" : "Open"}</button>
            </form>
            <p class="lock-screen__links">
                <a href={href({ view: "account" })}>Sign in</a> · <a href={href({ view: "libraries" })}>Other libraries</a>
            </p>
        </section>
    );
}
