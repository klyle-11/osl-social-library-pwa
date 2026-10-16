import { useState } from "preact/hooks";
import type { Takedown as Request } from "../../adapters/http-transport";
import { attempt, banned, directory, tell, useTransport } from "../state";

// When something here shouldn't be: what can be taken down, how, and what happens then.
// General information, not legal advice.
export function Takedown() {
    const d = directory.value;
    return (
        <article class="takedown">
            <h2 class="takedown__title">Taking something down</h2>
            <p class="takedown__text">
                If something in this library is yours and shouldn't be here, is about you, or does harm, ask for it to be taken down.
                The people who look after the library read every request.
            </p>
            {d?.contact
                ? <p class="takedown__contact"><span class="takedown__label">Contact</span> {d.contact}</p>
                : <p class="takedown__text">Use the form below, or ask whoever runs the library in person.</p>}

            <section class="takedown__section">
                <h3 class="takedown__heading">What happens</h3>
                <ul class="takedown__list">
                    <li>A note can be <b>struck out</b>: it stays where it was, with who wrote it, and its words become ***. Or it can be <b>removed</b> altogether.</li>
                    <li>A removed upload's file is deleted from the library, and the same file can't be added again.</li>
                    <li>The library's own copy is erased. Phones erase theirs the next time they connect.</li>
                    <li>What can't be reached can't be erased: a phone that never connects again, a file someone saved, or a drop point's flash until it is reset.</li>
                    <li>Anyone can take back what they wrote themselves, from the note or the document.</li>
                </ul>
            </section>

            <section class="takedown__section">
                <h3 class="takedown__heading">Copyright (DMCA)</h3>
                <p class="takedown__text">
                    Under the US Digital Millennium Copyright Act (17 U.S.C. § 512(c)(3)), a notice of claimed infringement should include:
                </p>
                <ol class="takedown__list takedown__list--numbered">
                    <li>Your physical or electronic signature (typing your full name is an electronic signature).</li>
                    <li>The copyrighted work you say is infringed, or a list if there are several.</li>
                    <li>The material you say infringes it, and enough to find it here: its title, the library, a link.</li>
                    <li>How to reach you: name, address, phone number, email.</li>
                    <li>A statement that you believe in good faith that the use isn't authorized by the copyright owner, its agent, or the law.</li>
                    <li>A statement that the information in the notice is accurate and, under penalty of perjury, that you are the owner or are authorized to act for the owner.</li>
                </ol>
                <p class="takedown__text">
                    <b>Counter-notice</b> (§ 512(g)(3)). If something you uploaded was removed and you believe that was a mistake or a misidentification, send:
                    your signature; what was removed and where it was; a statement under penalty of perjury that you believe in good faith it was removed by mistake
                    or misidentification; your name, address and phone number; and a statement that you consent to the jurisdiction of the federal district court
                    for your address (or, outside the US, any judicial district where the library's operator may be found) and will accept service of process
                    from whoever sent the notice.
                </p>
            </section>

            <section class="takedown__section">
                <h3 class="takedown__heading">Privacy, harassment, harm</h3>
                <p class="takedown__text">
                    Personal information, a photo of you, harassment, threats, anything unlawful: no legal form is needed. Say what it is and where.
                    Ask in person too: someone looking after the library can strike it out on the spot.
                </p>
            </section>

            <RequestForm />

            <section class="takedown__section takedown__section--operators">
                <h3 class="takedown__heading">For whoever runs this library</h3>
                <p class="takedown__text">
                    This page is general information, not legal advice. In the US, a service provider relies on the § 512 safe harbor only if it has
                    designated an agent to receive notices with the US Copyright Office, and acts expeditiously on valid notices. Put your contact details on the
                    Moderate page so they show here and, if you choose, with bans. Other countries have their own rules.
                </p>
            </section>
            {banned.value && <p class="takedown__text">This device is banned from the library, but it can still send a request.</p>}
        </article>
    );
}

function RequestForm() {
    const transport = useTransport();
    const [kind, setKind] = useState<Request["kind"]>("copyright");
    const [name, setName] = useState("");
    const [contact, setContact] = useState("");
    const [work, setWork] = useState("");
    const [where, setWhere] = useState("");
    const [faith, setFaith] = useState(false);
    const [accurate, setAccurate] = useState(false);
    const [signature, setSignature] = useState("");
    const [sent, setSent] = useState(false);
    const copyright = kind === "copyright";
    const text = (set: (v: string) => void) => (e: Event) => set((e.currentTarget as HTMLInputElement).value);

    if (sent) return <p class="takedown__sent" role="status">Sent. The people who look after the library will read it and get back to you.</p>;
    return (
        <form class="takedown__form" onSubmit={e => {
            e.preventDefault();
            attempt(async () => {
                await transport.takedown({ kind, name, contact, work, where, statement: copyright ? faith && accurate : true, signature });
                setSent(true);
                tell("Your request was sent.");
            });
        }}>
            <h3 class="takedown__heading">Send a request</h3>
            <label class="takedown__field">What kind
                <select value={kind} onChange={e => setKind((e.currentTarget as HTMLSelectElement).value as Request["kind"])}>
                    <option value="copyright">Copyright: it's my work (or I act for its owner)</option>
                    <option value="privacy">Privacy: it's about me</option>
                    <option value="harm">Harassment, threats or other harm</option>
                    <option value="other">Something else</option>
                </select>
            </label>
            <label class="takedown__field">Your name<input value={name} required maxLength={200} autocomplete="name" onInput={text(setName)} /></label>
            <label class="takedown__field">How to reach you (email, phone, address)<input value={contact} required maxLength={300} onInput={text(setContact)} /></label>
            <label class="takedown__field">{copyright ? "The work you own (or a list)" : "What's wrong with it"}
                <textarea value={work} rows={3} maxLength={3000} required={copyright} onInput={text(setWork)} />
            </label>
            <label class="takedown__field">Where it is here: titles, notes, links
                <textarea value={where} rows={3} maxLength={3000} required onInput={text(setWhere)} />
            </label>
            {copyright && (
                <>
                    <label class="takedown__check">
                        <input type="checkbox" checked={faith} required onChange={e => setFaith((e.currentTarget as HTMLInputElement).checked)} />
                        <span>I believe in good faith that this use isn't authorized by the copyright owner, its agent, or the law.</span>
                    </label>
                    <label class="takedown__check">
                        <input type="checkbox" checked={accurate} required onChange={e => setAccurate((e.currentTarget as HTMLInputElement).checked)} />
                        <span>The information here is accurate, and under penalty of perjury, I am the owner or authorized to act for the owner.</span>
                    </label>
                    <label class="takedown__field">Signature (type your full name)<input value={signature} required maxLength={200} onInput={text(setSignature)} /></label>
                </>
            )}
            <button class="takedown__send" type="submit">Send the request</button>
        </form>
    );
}
