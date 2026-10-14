import { presence, views, viewer } from "../state";
import { mediumLabel } from "../format";
import { href } from "../route";
import { KeepButton } from "./KeepButton";
import { Thumbnail } from "./Thumbnail";

export function DocumentCard({ id, onRemove }: { id: string, onRemove?: () => void }) {
    const v = views.value;
    const doc = v.documents[id];
    if (!doc) return null;
    const p = doc.properties;
    const notes = v.threads[id]?.length ?? 0;
    const viewing = presence.value.online.filter(e => e.viewing === id && e.user !== viewer.value).length;
    const onScreen = presence.value.showing?.documentId === id;
    return (
        <article class={`document-card${onScreen ? " document-card--on-screen" : ""}`}>
            <a class="document-card__link" href={href({ view: "document", id })}>
                <Thumbnail doc={doc} modifier="card" />
                <h3 class="document-card__title">{p.title}</h3>
                {p.author && <p class="document-card__author">{p.author}</p>}
                <p class="document-card__meta">
                    {[mediumLabel(p.type), p.year].filter(Boolean).join(" · ")}
                    {notes > 0 && ` · ${notes} note${notes === 1 ? "" : "s"}`}
                </p>
                {(onScreen || viewing > 0) && (
                    <p class="document-card__live">
                        {onScreen && <span class="document-card__badge">On the screen</span>}
                        {viewing > 0 && <span class="document-card__viewing">{viewing} viewing</span>}
                    </p>
                )}
            </a>
            <KeepButton id={id} />
            {onRemove && <button class="document-card__remove" type="button" onClick={onRemove}>Remove</button>}
        </article>
    );
}
