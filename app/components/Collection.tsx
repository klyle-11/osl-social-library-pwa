import { useState } from "preact/hooks";
import { KEPT_NAME } from "../../core/views";
import { attempt, useLibrary, views, viewer } from "../state";
import { displayName } from "../format";
import { DocumentCard } from "./DocumentCard";
import { canCarry } from "../../adapters/carry";

export function Collection({ id }: { id: string }) {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const c = v.collections[id];
    const [editing, setEditing] = useState(false);
    const [name, setName] = useState("");

    if (!c) return <p class="collection collection--empty">This collection is empty.</p>;
    const mine = c.owner === me;
    const renamable = mine && !id.endsWith("/kept");

    return (
        <section class="collection">
            <header class="collection__header">
                {editing ? (
                    <form class="collection__rename" onSubmit={e => {
                        e.preventDefault();
                        if (!name.trim()) return;
                        attempt(async () => { await store.nameCollection(id, name); setEditing(false); });
                    }}>
                        <label class="collection__rename-label">
                            Name
                            <input class="collection__rename-input" value={name} maxLength={80} autoFocus
                                onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                        </label>
                        <button class="collection__rename-save" type="submit">Save</button>
                        <button class="collection__rename-cancel" type="button" onClick={() => setEditing(false)}>Cancel</button>
                    </form>
                ) : (
                    <h2 class="collection__title"><span class="mark">{c.name ?? "Untitled collection"}</span></h2>
                )}
                <p class="collection__by">by <span class="mark">{displayName(c.owner, v.names, me)}</span> · {c.documentIds.length} documents</p>
                {renamable && !editing && (
                    <button class="collection__rename-open" type="button"
                        onClick={() => { setName(c.name ?? ""); setEditing(true); }}>{c.name ? "Rename" : "Name it"}</button>
                )}
                {mine && (canCarry()
                    ? <p class="collection__carry">{c.name === KEPT_NAME ? "Everything you keep" : "Everything here"} is saved on this phone for offline use.</p>
                    : <p class="collection__carry">Kept in your collection, which everyone can see. Saving copies on this phone for offline use needs the library's secure address (https), which comes with the domain.</p>)}
            </header>

            {c.documentIds.length ? (
                <ul class="collection__list">
                    {c.documentIds.map(docId => (
                        <li class="collection__item" key={docId}>
                            <DocumentCard id={docId}
                                onRemove={mine ? () => attempt(() => store.removeFromCollection(id, docId)) : undefined} />
                        </li>
                    ))}
                </ul>
            ) : <p class="collection__empty">Nothing in here yet.</p>}
        </section>
    );
}
