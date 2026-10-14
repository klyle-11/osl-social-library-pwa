import { attempt, presence, stewards, tell, tokens, useLibrary, useTransport, views, viewer } from "../state";
import { displayName, listPeople, mediumLabel, when } from "../format";
import { href } from "../route";
import { KeepButton } from "./KeepButton";
import { DocumentViewer } from "./DocumentViewer";
import { CollectionPicker } from "./CollectionPicker";
import { AnnotationThread } from "./AnnotationThread";
import { AnnotationForm } from "./AnnotationForm";
import { DetailsForm } from "./DetailsForm";

// The reader: the document itself on the left, and everything people have said
// or filled in about it on the right. On a phone the panel sits below the document.
export function SingleDocumentView({ id }: { id: string }) {
    const store = useLibrary();
    const transport = useTransport();
    const v = views.value;
    const me = viewer.value;
    const doc = v.documents[id];

    if (!doc) {
        return (
            <section class="single-document single-document--missing">
                <p class="single-document__missing">This document isn't here (it may have been hidden).</p>
                <a class="single-document__back" href={href({ view: "gallery" })}>Back to the library</a>
            </section>
        );
    }

    const p = doc.properties;
    const canHide = doc.user === me || stewards.value.includes(me);
    const others = presence.value.online.filter(e => e.viewing === id && e.user !== me).map(e => e.user);
    const presenter = tokens.value.presenter;
    const onScreen = presence.value.showing?.documentId === id;

    return (
        <article class="single-document">
            <div class="single-document__stage">
                <a class="single-document__back" href={href({ view: "gallery" })}>← The library</a>
                <DocumentViewer doc={doc} />
            </div>

            <aside class="single-document__panel">
                <header class="single-document__header">
                    <h2 class="single-document__title">{p.title}</h2>
                    {p.subtitle && <p class="single-document__subtitle">{p.subtitle}</p>}
                    {p.author && <p class="single-document__author">{p.author}</p>}
                    <p class="single-document__meta">{[mediumLabel(p.type), p.year].filter(Boolean).join(" · ")}</p>
                    {p.description && <p class="single-document__description">{p.description}</p>}
                    <p class="single-document__by">
                        added by {displayName(doc.user, v.names, me)} · <time dateTime={doc.timestamp}>{when(doc.timestamp)}</time>
                    </p>
                </header>

                {others.length > 0 && (
                    <p class="single-document__viewing" role="status">
                        <span class="single-document__dot" aria-hidden="true" />
                        {listPeople(others, v.names)} {others.length === 1 ? "is" : "are"} also viewing this document.
                    </p>
                )}

                <div class="single-document__actions">
                    <KeepButton id={id} />
                    <CollectionPicker documentId={id} />
                    {presenter && (
                        <button class="single-document__show" type="button" aria-pressed={onScreen}
                            onClick={() => attempt(async () => {
                                await transport.show(presenter, onScreen ? null : id, me);
                                tell(onScreen ? "Taken off the screen." : "Now on the screen for everyone.");
                            })}>{onScreen ? "Take off the screen" : "Show on the screen"}</button>
                    )}
                    {canHide && (
                        <button class="single-document__hide" type="button"
                            onClick={() => attempt(() => store.hide(id))}>Hide this document</button>
                    )}
                </div>

                <details class="single-document__details">
                    <summary class="single-document__details-summary">Details — add or correct what's known</summary>
                    <DetailsForm id={id} />
                </details>

                <section class="single-document__conversation">
                    <h3 class="single-document__conversation-title">Notes</h3>
                    <AnnotationThread documentId={id} />
                    <AnnotationForm documentId={id} />
                </section>
            </aside>
        </article>
    );
}
