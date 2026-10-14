import { attempt, stewards, useLibrary, views, viewer } from "../state";
import { displayName, when } from "../format";

export function AnnotationThread({ documentId }: { documentId: string }) {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const thread = v.threads[documentId] ?? [];
    if (!thread.length) return <p class="annotation-thread annotation-thread--empty">No notes yet. Know something about this? Add the first one.</p>;
    return (
        <ol class="annotation-thread">
            {thread.map(({ op, anonymous, mine }) => (
                <li class={`annotation-thread__item annotation-thread__item--${op.access}`} key={op.id}>
                    <p class="annotation-thread__meta">
                        <span class="annotation-thread__author">{anonymous && !mine ? "Someone" : displayName(op.user, v.names, me)}</span>
                        {" · "}<time class="annotation-thread__time" dateTime={op.timestamp}>{when(op.timestamp)}</time>
                        {op.access !== "public" && <span class="annotation-thread__access"> · {op.access === "private" ? "only you can see this" : "shown without your name"}</span>}
                    </p>
                    <p class="annotation-thread__body">{op.body}</p>
                    {(mine || stewards.value.includes(me)) && (
                        <button class="annotation-thread__hide" type="button" onClick={() => attempt(() => store.hide(op.id))}>Hide</button>
                    )}
                </li>
            ))}
        </ol>
    );
}
