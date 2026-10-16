import { presence, views, viewer } from "../state";
import { displayName, fileKind, fileUrl, formatLabel, mediumLabel, when } from "../format";
import { href } from "../route";
import { KeepButton } from "./KeepButton";
import { Thumbnail } from "./Thumbnail";
import { AudioButtons } from "./AudioBar";

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
                <h3 class="document-card__title"><span class="mark">{p.title}</span></h3>
                {p.author && <p class="document-card__author"><span class="mark">{p.author}</span></p>}
                <p class="document-card__meta">
                    {[p.type && mediumLabel(p.type), formatLabel(doc.fileType), p.year].filter(Boolean).join(" · ")}
                    {notes > 0 && ` · ${notes} note${notes === 1 ? "" : "s"}`}
                </p>
                <p class="document-card__added">
                    Added by <span class="mark">{displayName(doc.user, v, viewer.value)}</span> · <time dateTime={doc.timestamp}>{when(doc.timestamp)}</time>
                </p>
                {(onScreen || viewing > 0) && (
                    <p class="document-card__live">
                        {onScreen && <span class="document-card__badge">On the screen</span>}
                        {viewing > 0 && <span class="document-card__viewing">{viewing} viewing</span>}
                    </p>
                )}
            </a>
            {fileKind(doc.fileType) === "audio" && fileUrl(doc) && <AudioButtons id={id} />}
            <KeepButton id={id} />
            {onRemove && <button class="document-card__remove" type="button" onClick={onRemove}>Remove</button>}
        </article>
    );
}
