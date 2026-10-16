import { useState } from "preact/hooks";
import { answering, views, viewer } from "../state";
import { displayName } from "../format";

// The uploader's prompts: notes they pinned, shown as strips of paper coming off the
// right side of the document, just above where people write. Tapping one starts a
// reply to it. They tuck away to a tab when they're in the way of the reading.
export function PromptStrips({ documentId, place = "reader" }: { documentId: string, place?: "reader" | "screen" }) {
    const v = views.value;
    const me = viewer.value;
    const prompts = v.prompts[documentId] ?? [];
    const [tucked, setTucked] = useState(false);
    if (!prompts.length) return null;
    const screen = place === "screen";

    return (
        <aside class={`prompt-strips prompt-strips--${place}${tucked ? " prompt-strips--tucked" : ""}`} aria-label="Prompts">
            {!screen && (
                <button class="prompt-strips__tab" type="button" aria-expanded={!tucked} onClick={() => setTucked(!tucked)}>
                    {tucked ? `Prompts (${prompts.length})` : "Tuck away"}
                </button>
            )}
            {!tucked && (
                <ol class="prompt-strips__list">
                    {prompts.map((n, i) => {
                        const by = n.access === "anonymous" ? "" : displayName(n.user, v.names, me);
                        const strip = (
                            <>
                                <span class="prompt-strips__text">{n.body}</span>
                                {by && <span class="prompt-strips__by">{by}</span>}
                            </>
                        );
                        return (
                            <li class="prompt-strips__item" key={n.id} style={{ "--tilt": `${i % 2 ? 0.7 : -0.6}deg` }}>
                                {screen
                                    ? <div class="prompt-strips__strip">{strip}</div>
                                    : <button class="prompt-strips__strip" type="button" title="Answer this prompt"
                                        onClick={() => { answering.value = { documentId, noteId: n.id, name: by || "the prompt" }; }}>{strip}</button>}
                            </li>
                        );
                    })}
                </ol>
            )}
        </aside>
    );
}
