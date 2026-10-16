import { useEffect, useRef, useState } from "preact/hooks";
import type { NodeInfo } from "../../adapters/http-transport";
import { attempt, presence, tokens, useTransport, views, viewer } from "../state";
import { displayName, listPeople, mediumLabel, when } from "../format";
import { href } from "../route";
import { DocumentViewer } from "./DocumentViewer";
import { PromptStrips } from "./PromptStrips";
import { QrCode } from "./QrCode";
import { MAIN, libraryId } from "../library";

// The big screen: what the room is looking at, how to join, who is here, and
// every note as it arrives. It only displays; a paired presenter chooses what's on it.
export function Present() {
    const transport = useTransport();
    const v = views.value;
    const me = viewer.value;
    const showing = presence.value.showing;
    const doc = showing ? v.documents[showing.documentId] : undefined;
    const presenter = tokens.value.presenter;
    const thread = doc ? v.threads[doc.id] ?? [] : [];
    const people = presence.value.online.map(p => p.user).filter(u => u !== me);

    const [info, setInfo] = useState<NodeInfo | null>(null);
    useEffect(() => { void transport.info().then(setInfo); }, []);
    // Phones can't reach "localhost": that is the screen's own name for itself.
    // So when the screen was opened that way, show the node's address on the network.
    const local = /^(localhost|127\.|\[::1\])/.test(location.host);
    const origin = (local ? info?.addresses[0] : undefined) ?? location.origin;
    // another library than the main one: the code takes phones straight into it
    const address = libraryId === MAIN ? origin : `${origin}/?library=${libraryId}`;

    // Keep the newest note in view as they arrive. Only the notes scroll: scrollIntoView
    // would also drag the document up the screen. (On a narrow screen the whole side panel scrolls.)
    const notes = useRef<HTMLElement>(null);
    useEffect(() => {
        for (const box of [notes.current, notes.current?.parentElement]) if (box) box.scrollTop = box.scrollHeight;
    }, [thread.length, doc?.id]);

    const step = (by: number) => {
        if (!presenter || !v.documentOrder.length) return;
        const i = doc ? v.documentOrder.indexOf(doc.id) : -1;
        const next = v.documentOrder[(i + by + v.documentOrder.length) % v.documentOrder.length];
        void attempt(() => transport.show(presenter, next, me));
    };

    return (
        <div class="present">
            <header class="present__bar">
                <span class="present__brand">OSL</span>
                <span class="present__people">
                    {people.length === 0 ? "Waiting for people to join" : `${listPeople(people, v)} ${people.length === 1 ? "is" : "are"} here`}
                </span>
                {presenter && (
                    <span class="present__controls">
                        <button class="present__button" type="button" onClick={() => step(-1)}>Previous</button>
                        <button class="present__button" type="button" onClick={() => step(1)}>Next</button>
                        <button class="present__button" type="button" onClick={() => attempt(() => transport.show(presenter, null, me))}>Clear</button>
                    </span>
                )}
                <a class="present__exit" href={href({ view: "gallery" })}>Leave screen view</a>
            </header>

            <main class="present__stage">
                {doc
                    ? <><DocumentViewer doc={doc} /><PromptStrips documentId={doc.id} place="screen" /></>
                    : (
                        <div class="present__idle">
                            <p class="present__idle-title">Nothing is on the screen yet.</p>
                            <p class="present__idle-text">
                                {presenter
                                    ? "Press Next, or open a document on any paired device and choose “Show on the screen”."
                                    : "Pair a device as the presenter (You → Pair this device), open a document, and choose “Show on the screen”."}
                            </p>
                        </div>
                    )}
            </main>

            <aside class="present__side">
                {doc && (
                    <header class="present__document">
                        <h1 class="present__title">{doc.properties.title}</h1>
                        <p class="present__meta">
                            {[doc.properties.author, mediumLabel(doc.properties.type), doc.properties.year].filter(Boolean).join(" · ")}
                        </p>
                    </header>
                )}

                <section class="present__join">
                    <QrCode value={address} label={`Join at ${address}`} />
                    <p class="present__join-text">
                        <span class="present__join-label">Join on your phone</span>
                        <span class="present__address">{address.replace(/^https?:\/\//, "")}</span>
                    </p>
                </section>

                <section class="present__notes" ref={notes}>
                    <h2 class="present__notes-title">{doc ? `Notes (${thread.length})` : "Latest"}</h2>
                    <ol class="present__notes-list">
                        {doc && thread.map(({ op, anonymous, depth }) => (
                            <li class={`present__note${depth ? " present__note--reply" : ""}`} key={op.id} style={{ marginLeft: `${Math.min(depth, 3) * 1.5}rem` }}>
                                <p class="present__note-body">{op.body}</p>
                                <p class="present__note-by">{anonymous ? "Someone" : displayName(op.user, v, "")} · {when(op.timestamp)}</p>
                            </li>
                        ))}
                        {!doc && v.feed.filter(e => e.kind === "annotation").slice(0, 8).map(e => e.kind === "annotation" && (
                            <li class="present__note" key={e.op.id}>
                                <p class="present__note-body">{e.op.body}</p>
                                <p class="present__note-by">on {v.documents[e.documentId]?.properties.title ?? "a document"}</p>
                            </li>
                        ))}
                        {doc && thread.length === 0 && <li class="present__note present__note--empty">No notes yet. Open this on your phone and add the first.</li>}
                    </ol>
                </section>
            </aside>
        </div>
    );
}
