import { useRef, useState } from "preact/hooks";
import type { Access } from "../../core/types";
import { attempt, useLibrary } from "../state";

// A note on the whole document. On a wide screen it's pinned to the bottom of the
// side panel, so it's in reach wherever you are in the reading or the notes.
export function AnnotationForm({ documentId }: { documentId: string }) {
    const store = useLibrary();
    const [body, setBody] = useState("");
    const [access, setAccess] = useState<Access>("public");
    const box = useRef<HTMLTextAreaElement>(null);
    return (
        <form class="annotation-form" onSubmit={e => {
            e.preventDefault();
            if (!body.trim()) return;
            attempt(async () => {
                await store.annotate(documentId, body, access);
                setBody("");
                if (box.current) box.current.style.height = "";
            });
        }}>
            <label class="annotation-form__label">
                Add a note on this document
                <textarea class="annotation-form__body" ref={box} value={body} maxLength={1000} rows={2}
                    placeholder="What do you know about this? What does it remind you of?"
                    onInput={e => {
                        const t = e.currentTarget as HTMLTextAreaElement;
                        setBody(t.value);
                        t.style.height = "auto";   // grow with the text, up to a few lines
                        t.style.height = `${Math.min(t.scrollHeight, 160)}px`;
                    }} />
            </label>
            <div class="annotation-form__row">
                <select class="annotation-form__access" aria-label="Who sees it" value={access}
                    onChange={e => setAccess((e.currentTarget as HTMLSelectElement).value as Access)}>
                    <option value="public">Everyone, with my name</option>
                    <option value="anonymous">Everyone, without my name</option>
                    <option value="private">Only me (stays on this device)</option>
                </select>
                <button class="annotation-form__submit" type="submit" disabled={!body.trim()}>Post note</button>
            </div>
        </form>
    );
}
