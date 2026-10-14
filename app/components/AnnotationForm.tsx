import { useState } from "preact/hooks";
import type { Access } from "../../core/types";
import { attempt, useLibrary } from "../state";

export function AnnotationForm({ documentId }: { documentId: string }) {
    const store = useLibrary();
    const [body, setBody] = useState("");
    const [access, setAccess] = useState<Access>("public");
    return (
        <form class="annotation-form" onSubmit={e => {
            e.preventDefault();
            if (!body.trim()) return;
            attempt(async () => { await store.annotate(documentId, body, access); setBody(""); });
        }}>
            <label class="annotation-form__label">
                Add a note
                <textarea class="annotation-form__body" value={body} maxLength={1000} rows={3}
                    placeholder="What do you know about this? What does it remind you of?"
                    onInput={e => setBody((e.currentTarget as HTMLTextAreaElement).value)} />
            </label>
            <fieldset class="annotation-form__access">
                <legend class="annotation-form__access-legend">Who sees it</legend>
                {([["public", "Everyone, with my name"], ["anonymous", "Everyone, without my name"], ["private", "Only me (stays on this phone)"]] as [Access, string][]).map(([value, label]) => (
                    <label class="annotation-form__access-option" key={value}>
                        <input type="radio" name="access" value={value} checked={access === value}
                            onChange={() => setAccess(value)} /> {label}
                    </label>
                ))}
            </fieldset>
            <button class="annotation-form__submit" type="submit">Post note</button>
        </form>
    );
}
