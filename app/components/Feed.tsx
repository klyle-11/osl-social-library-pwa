import { views, viewer } from "../state";
import { displayName, when } from "../format";
import { href } from "../route";
import type { FeedEntry } from "../../core/views";

// Chronological, newest first, with an end. No ranking, no infinite scroll.
export function Feed() {
    const v = views.value;
    return (
        <section class="feed">
            <h2 class="feed__title">Activity</h2>
            <ol class="feed__list">
                {v.feed.map(entry => <FeedItem key={entry.op.id} entry={entry} />)}
            </ol>
            <p class="feed__end">You're caught up. <a class="feed__add" href={href({ view: "add" })}>Add something?</a></p>
        </section>
    );
}

function FeedItem({ entry }: { entry: FeedEntry }) {
    const v = views.value;
    const me = viewer.value;
    const who = (user: string) => <span class="mark">{displayName(user, v.names, me)}</span>;
    const docLink = (id: string) => (
        <a class="feed__document" href={href({ view: "document", id })}>{v.documents[id]?.properties.title ?? "a document"}</a>
    );

    let body;
    switch (entry.kind) {
        case "document":
            body = <>{who(entry.op.user)} added {docLink(entry.op.id)}</>;
            break;
        case "describe":
            body = <>{who(entry.op.user)} filled in the {entry.op.field === "type" ? "kind" : entry.op.field} of {docLink(entry.documentId)}</>;
            break;
        case "annotation":
            body = <>
                {entry.op.access === "anonymous" ? "Someone" : who(entry.op.user)}
                {entry.op.replyTo ? " replied to a note" : ""} on {docLink(entry.documentId)}:
                <blockquote class="feed__quote">{entry.op.body}</blockquote>
            </>;
            break;
        case "collect": {
            const c = v.collections[entry.op.collectionId];
            body = <>{who(entry.op.user)} kept {docLink(entry.documentId)} in{" "}
                <a class="feed__collection" href={href({ view: "collection", id: entry.op.collectionId })}>{c?.name ?? "a collection"}</a></>;
            break;
        }
        case "collection":
            body = <>{who(entry.op.user)} started a collection:{" "}
                <a class="feed__collection" href={href({ view: "collection", id: entry.op.collectionId })}>
                    {v.collections[entry.op.collectionId]?.name ?? entry.op.name}
                </a></>;
            break;
    }

    return (
        <li class={`feed__item feed__item--${entry.kind}`}>
            <p class="feed__text">{body}</p>
            <time class="feed__time" dateTime={entry.op.timestamp}>{when(entry.op.timestamp)}</time>
        </li>
    );
}
