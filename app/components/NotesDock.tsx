import { useEffect, useRef, useState } from "preact/hooks";
import type { Access } from "../../core/types";
import { attempt, presence, useLibrary, views, viewer } from "../state";
import { displayName, listPeople, when } from "../format";

const ACCESS: [Access, string][] = [["public", "Everyone, with my name"], ["anonymous", "Everyone, without my name"], ["private", "Only me"]];

// The conversation within thumb's reach: along the bottom of a phone, and of the
// full-screen reader anywhere. Closed, it's one line of who's here and the newest
// note, and a box to write in; open, the latest notes, newest at the bottom.
export function NotesDock({ documentId }: { documentId: string }) {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const [open, setOpen] = useState(false);
    const [body, setBody] = useState("");
    const [access, setAccess] = useState<Access>("public");
    const [replyTo, setReplyTo] = useState<{ id: string, name: string } | null>(null);
    const list = useRef<HTMLOListElement>(null);
    const dock = useRef<HTMLElement>(null);
    const input = useRef<HTMLTextAreaElement>(null);

    // the page (and the full-screen reader) keep clear of the dock: they read its height
    useEffect(() => {
        const el = dock.current;
        if (!el) return;
        const root = document.documentElement.style;
        const ro = new ResizeObserver(() => root.setProperty("--notes-dock", `${el.offsetHeight}px`));
        ro.observe(el);
        return () => { ro.disconnect(); root.removeProperty("--notes-dock"); };
    }, []);
    // back to one line once a note is sent
    useEffect(() => { if (!body && input.current) input.current.style.height = ""; }, [body]);

    const thread = v.threads[documentId] ?? [];
    const others = presence.value.online.filter(e => e.user !== me);
    const here = others.filter(e => e.viewing === documentId).map(e => e.user);
    const newest = [...thread].reverse().find(a => !a.mine);
    const author = (a: typeof thread[number]) => a.anonymous && !a.mine ? "Someone" : displayName(a.op.user, v.names, me);

    // the newest note in view when it opens, and as notes arrive
    useEffect(() => { if (open && list.current) list.current.scrollTop = list.current.scrollHeight; }, [open, thread.length]);
    useEffect(() => {
        if (!open) return;
        const close = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        addEventListener("keydown", close);
        return () => removeEventListener("keydown", close);
    }, [open]);

    const status = [
        others.length ? `${others.length} other${others.length === 1 ? "" : "s"} online` : "Nobody else online",
        here.length ? `${listPeople(here, v.names)} ${here.length === 1 ? "is" : "are"} reading this` : "",
        `${thread.length} note${thread.length === 1 ? "" : "s"}`
    ].filter(Boolean).join(" · ");

    return (
        <aside class={`notes-dock${open ? " notes-dock--open" : ""}`} aria-label="Notes" ref={dock}>
            <button class="notes-dock__toggle" type="button" aria-expanded={open} onClick={() => setOpen(o => !o)}>
                <span class="notes-dock__status">
                    <span class={`notes-dock__dot${others.length ? " notes-dock__dot--live" : ""}`} aria-hidden="true" />
                    {status}
                </span>
                {!open && newest && (
                    <span class="notes-dock__preview"><b class="mark">{author(newest)}</b>: {newest.op.body}</span>
                )}
                <span class="notes-dock__chevron" aria-hidden="true">{open ? "▾" : "▴"}</span>
            </button>

            {open && (
                <div class="notes-dock__sheet">
                    {others.length > 0 && (
                        <p class="notes-dock__people">Online: {listPeople(others.map(e => e.user), v.names)}</p>
                    )}
                    {thread.length ? (
                        <ol class="notes-dock__list" ref={list}>
                            {thread.slice(-50).map(a => (
                                <li class={`notes-dock__note${a.mine ? " notes-dock__note--mine" : ""}${replyTo?.id === a.op.id ? " notes-dock__note--answering" : ""}`}
                                    key={a.op.id} style={{ marginLeft: `${Math.min(a.depth, 3)}rem` }}>
                                    <p class="notes-dock__meta">
                                        <span class="mark">{author(a)}</span> · <time dateTime={a.op.timestamp}>{when(a.op.timestamp)}</time>
                                        {a.op.access === "private" && " · only you"}
                                    </p>
                                    <p class="notes-dock__body">{a.op.body}</p>
                                    <button class="notes-dock__reply" type="button" onClick={() => {
                                        setReplyTo({ id: a.op.id, name: author(a) });
                                        input.current?.focus();
                                    }}>Reply</button>
                                </li>
                            ))}
                        </ol>
                    ) : <p class="notes-dock__empty">No notes yet. Know something about this? Write the first one.</p>}
                    <label class="notes-dock__access">
                        Who sees it
                        <select value={access} onChange={e => setAccess((e.currentTarget as HTMLSelectElement).value as Access)}>
                            {ACCESS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                </div>
            )}

            {replyTo && (
                <p class="notes-dock__replying">
                    Replying to {replyTo.name}
                    <button class="notes-dock__unreply" type="button" aria-label="Don't reply, write a new note" onClick={() => setReplyTo(null)}>×</button>
                </p>
            )}
            <form class="notes-dock__form" onSubmit={e => {
                e.preventDefault();
                if (!body.trim()) return;
                attempt(async () => { await store.annotate(documentId, body, access, replyTo?.id); setBody(""); setReplyTo(null); });
            }}>
                <textarea class="notes-dock__input" ref={input} rows={1} maxLength={1000} value={body} aria-label="Write a note"
                    placeholder={replyTo ? `Reply to ${replyTo.name}…` : access === "private" ? "A note only you will see…" : "Write a note…"}
                    onInput={e => {
                        const t = e.currentTarget as HTMLTextAreaElement;
                        setBody(t.value);
                        t.style.height = "auto";   // grow with the text, up to a few lines
                        t.style.height = `${Math.min(t.scrollHeight, 120)}px`;
                    }}
                    onKeyDown={e => {
                        // Enter sends on a keyboard; Shift+Enter (and a phone's return key) make a new line
                        if (e.key === "Enter" && !e.shiftKey && matchMedia("(hover: hover)").matches) {
                            e.preventDefault();
                            (e.currentTarget as HTMLTextAreaElement).form?.requestSubmit();
                        }
                    }} />
                <button class="notes-dock__send" type="submit" disabled={!body.trim()}>Send</button>
            </form>
        </aside>
    );
}
