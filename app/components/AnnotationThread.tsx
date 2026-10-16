import { useState } from "preact/hooks";
import type { Access } from "../../core/types";
import type { AnnotationView } from "../../core/views";
import { attempt, isMe, isSteward, useLibrary, viewer, views } from "../state";
import { displayName, when } from "../format";

const MAX_PROMPTS = 8;

// Pin a note as one of the document's prompts, or take it off: the uploader's (and stewards') to do.
export function PinButton({ documentId, noteId, small = false }: { documentId: string, noteId: string, small?: boolean }) {
    const store = useLibrary();
    const pinned = (views.value.prompts[documentId] ?? []).map(n => n.id);
    const on = pinned.includes(noteId);
    const full = !on && pinned.length >= MAX_PROMPTS;
    return (
        <button class={`pin-button${on ? " pin-button--on" : ""}${small ? " pin-button--small" : ""}`} type="button" aria-pressed={on} disabled={full}
            title={full ? `Up to ${MAX_PROMPTS} prompts` : on ? "Take it off the document" : "Show it on the document, for everyone to answer"}
            onClick={() => attempt(() => store.setPrompts(documentId, on ? pinned.filter(id => id !== noteId) : [...pinned, noteId]))}>
            {on ? "Unpin prompt" : "Pin as prompt"}
        </button>
    );
}

// Your own note: delete it. Someone else's, as a steward: strike it out (it stays, with
// who wrote it, its words ***) or remove it. Either way its words are erased everywhere.
export function TakeBack({ id, mine, struck = false }: { id: string, mine: boolean, struck?: boolean }) {
    const store = useLibrary();
    const take = (mode: "strike" | "remove", question: string) => {
        if (confirm(question)) void attempt(() => store.redact(id, mode));
    };
    if (mine) return <button class="take-back" type="button" onClick={() => take("remove", "Delete your note? It's erased from the library and from phones as they connect.")}>Delete</button>;
    if (!isSteward()) return null;
    return (
        <>
            {!struck && <button class="take-back" type="button" onClick={() => take("strike", "Strike it out? It stays, with who wrote it, and its words become ***.")}>Strike out</button>}
            <button class="take-back" type="button" onClick={() => take("remove", "Remove it altogether?")}>Remove</button>
        </>
    );
}

const MAX_INDENT = 4;   // deeper replies stop stepping right, and say who they answer instead

export function AnnotationThread({ documentId }: { documentId: string }) {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const [replying, setReplying] = useState<string | null>(null);
    const thread = v.threads[documentId] ?? [];
    const doc = v.documents[documentId];
    const mayPin = !!doc && (isMe(doc.user) || isSteward());
    const pinned = new Set((v.prompts[documentId] ?? []).map(n => n.id));
    if (!thread.length) return <p class="annotation-thread annotation-thread--empty">No notes yet. Know something about this? Add the first one.</p>;
    const name = (a: AnnotationView | { op: AnnotationView["op"], anonymous: boolean, mine: boolean }) =>
        a.anonymous && !a.mine ? "Someone" : displayName(a.op.user, v, me);
    return (
        <ol class="annotation-thread">
            {thread.map(a => {
                const { op, mine, depth, parent } = a;
                return (
                    <li class={`annotation-thread__item annotation-thread__item--${op.access}${depth ? " annotation-thread__item--reply" : ""}${pinned.has(op.id) ? " annotation-thread__item--prompt" : ""}`}
                        key={op.id} style={{ marginLeft: `${Math.min(depth, MAX_INDENT) * 1.25}rem` }}>
                        <p class="annotation-thread__meta">
                            {pinned.has(op.id) && <span class="annotation-thread__prompt">Prompt · </span>}
                            <span class="annotation-thread__author mark">{name(a)}</span>
                            {parent && depth > MAX_INDENT && <span class="annotation-thread__to"> ↳ to {parent.access === "anonymous" ? "someone" : displayName(parent.user, v, me)}</span>}
                            {" · "}<time class="annotation-thread__time" dateTime={op.timestamp}>{when(op.timestamp)}</time>
                            {op.access !== "public" && <span class="annotation-thread__access"> · {op.access === "private" ? "only you can see this" : "shown without your name"}</span>}
                        </p>
                        {a.struck
                            ? <p class="annotation-thread__body annotation-thread__body--struck" aria-label="Struck out">***</p>
                            : <p class="annotation-thread__body">{op.body}</p>}
                        <p class="annotation-thread__actions">
                            <button class="annotation-thread__reply" type="button" aria-expanded={replying === op.id}
                                onClick={() => setReplying(replying === op.id ? null : op.id)}>Reply</button>
                            {mayPin && op.access !== "private" && !a.struck && <PinButton documentId={documentId} noteId={op.id} />}
                            <TakeBack id={op.id} mine={mine} struck={a.struck} />
                        </p>
                        {replying === op.id && (
                            <ReplyForm to={name(a)} onSend={(body, access) => attempt(async () => {
                                await store.annotate(documentId, body, access, op.id);
                                setReplying(null);
                            })} onCancel={() => setReplying(null)} />
                        )}
                    </li>
                );
            })}
        </ol>
    );
}

function ReplyForm({ to, onSend, onCancel }: { to: string, onSend: (body: string, access: Access) => void, onCancel: () => void }) {
    const [body, setBody] = useState("");
    const [access, setAccess] = useState<Access>("public");
    return (
        <form class="reply-form" onSubmit={e => { e.preventDefault(); if (body.trim()) onSend(body, access); }}>
            <label class="reply-form__label">
                Reply to {to}
                <textarea class="reply-form__body" rows={2} maxLength={1000} value={body} autoFocus
                    onInput={e => setBody((e.currentTarget as HTMLTextAreaElement).value)} />
            </label>
            <div class="reply-form__row">
                <select class="reply-form__access" aria-label="Who sees it" value={access}
                    onChange={e => setAccess((e.currentTarget as HTMLSelectElement).value as Access)}>
                    <option value="public">Everyone, with my name</option>
                    <option value="anonymous">Everyone, without my name</option>
                    <option value="private">Only me</option>
                </select>
                <button class="reply-form__send" type="submit" disabled={!body.trim()}>Post reply</button>
                <button class="reply-form__cancel" type="button" onClick={onCancel}>Cancel</button>
            </div>
        </form>
    );
}
