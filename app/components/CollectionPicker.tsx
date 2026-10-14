import { useState } from "preact/hooks";
import { attempt, useLibrary, views, viewer } from "../state";

// Put this document into any of my collections, or start a new one with it.
export function CollectionPicker({ documentId }: { documentId: string }) {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const [name, setName] = useState("");
    const mine = v.collectionOrder.map(id => v.collections[id]).filter(c => c.owner === me && !c.id.endsWith("/kept"));
    const inIt = new Set(v.collectionsByDocument[documentId] ?? []);

    return (
        <details class="collection-picker">
            <summary class="collection-picker__toggle">Add to a collection</summary>
            <ul class="collection-picker__list">
                {mine.map(c => (
                    <li class="collection-picker__item" key={c.id}>
                        <label class="collection-picker__label">
                            <input
                                class="collection-picker__checkbox"
                                type="checkbox"
                                checked={inIt.has(c.id)}
                                onChange={e => attempt(() => (e.currentTarget as HTMLInputElement).checked
                                    ? store.addToCollection(c.id, [documentId])
                                    : store.removeFromCollection(c.id, documentId))}
                            />
                            {c.name ?? "Untitled collection"}
                        </label>
                    </li>
                ))}
            </ul>
            <form class="collection-picker__new" onSubmit={e => {
                e.preventDefault();
                if (!name.trim()) return;
                attempt(async () => { await store.createCollection(name, [documentId]); setName(""); });
            }}>
                <label class="collection-picker__new-label">
                    New collection
                    <input class="collection-picker__new-input" value={name} maxLength={80}
                        onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="collection-picker__new-button" type="submit">Create</button>
            </form>
        </details>
    );
}
