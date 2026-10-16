import { useState } from "preact/hooks";
import { attempt, useLibrary, views, viewer } from "../state";
import { displayName } from "../format";
import { href } from "../route";
import type { CollectionView } from "../../core/views";

export function Collections() {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const [name, setName] = useState("");
    const all = v.collectionOrder.map(id => v.collections[id]);
    const mine = all.filter(c => c.owner === me);
    // everyone's, the moment they're named: an emptied Kept is the only one left out
    const others = all.filter(c => c.owner !== me && (c.documentIds.length > 0 || (c.name !== null && !c.id.endsWith("/kept"))));

    return (
        <section class="collections">
            <h2 class="collections__title">Collections</h2>

            <form class="collections__new" onSubmit={e => {
                e.preventDefault();
                if (!name.trim()) return;
                attempt(async () => {
                    const id = await store.createCollection(name);
                    setName("");
                    location.hash = href({ view: "collection", id });
                });
            }}>
                <label class="collections__new-label">
                    Start a collection
                    <input class="collections__new-input" value={name} maxLength={80} placeholder="Name it (you can change it later)"
                        onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <button class="collections__new-button" type="submit">Create</button>
            </form>

            <h3 class="collections__heading">Yours</h3>
            {mine.length
                ? collectionList(mine)
                : <p class="collections__empty">Nothing yet. Tap Keep on anything in the library and it lands here.</p>}

            <h3 class="collections__heading">Everyone's</h3>
            {others.length
                ? collectionList(others)
                : <p class="collections__empty">No one else has made a collection yet.</p>}
        </section>
    );

    function collectionList(list: CollectionView[]) {
        return (
            <ul class="collections__list">
                {list.map(c => (
                    <li class="collections__item" key={c.id}>
                        <a class="collections__link" href={href({ view: "collection", id: c.id })}>
                            <span class="collections__name mark">{c.name ?? "Untitled collection"}</span>
                            <span class="collections__meta"> · {c.documentIds.length || "empty so far"} · by <span class="mark">{displayName(c.owner, v.names, me)}</span></span>
                        </a>
                    </li>
                ))}
            </ul>
        );
    }
}
