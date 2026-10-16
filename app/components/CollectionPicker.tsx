import { useState } from "preact/hooks";
import { attempt, person, useLibrary, views } from "../state";
import { href } from "../route";
import { KeepButton } from "./KeepButton";
import { describeAudience } from "./Audience";

// A document's collections, on its page: where it is now, Keep, and (opened) every
// collection this person may add to, with room to start a new one.
export function CollectionPicker({ documentId }: { documentId: string }) {
    const store = useLibrary();
    const v = views.value;
    const [open, setOpen] = useState(false);
    const [name, setName] = useState("");
    const [see, setSee] = useState<"everyone" | "owner">("everyone");
    const inIt = new Set(v.collectionsByDocument[documentId] ?? []);
    const all = v.collectionOrder.map(id => v.collections[id]);
    // mine first, then the ones shared with me to add to; Kept has its own button
    const choices = [...all.filter(c => c.mine), ...all.filter(c => !c.mine && c.mayAdd)].filter(c => !c.id.endsWith("/kept"));
    const here = all.filter(c => inIt.has(c.id));
    // in someone else's collection, only what you put there can you take out
    const mayTakeOut = (c: typeof all[number]) => {
        const by = c.addedBy[documentId];
        return c.mine || (!!by && (v.devices[by] ?? by) === person.value);
    };

    return (
        <section class="collect" aria-labelledby={`collect-${documentId}`}>
            <div class="collect__head">
                <h3 class="collect__title" id={`collect-${documentId}`}>Collections</h3>
                <KeepButton id={documentId} />
            </div>
            {here.length ? (
                <ul class="collect__in">
                    {here.map(c => (
                        <li class="collect__chip" key={c.id}>
                            <a href={href({ view: "collection", id: c.id })}>{c.name ?? "Untitled collection"}</a>
                            <span class="collect__chip-count">{c.documentIds.length}</span>
                        </li>
                    ))}
                </ul>
            ) : <p class="collect__none">Not in any collection yet.</p>}

            <button class="collect__toggle" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
                <span>{open ? "Close" : choices.length ? "Add to a collection" : "Start a collection with this"}</span>
                <span class="collect__toggle-count" aria-hidden="true">{open ? "▴" : choices.length ? `${choices.length} ▾` : "▾"}</span>
            </button>

            {open && (
                <div class="collect__panel">
                    {choices.length > 0 && (
                        <ul class="collect__list">
                            {choices.map(c => (
                                <li class="collect__item" key={c.id}>
                                    <label class="collect__row">
                                        <input class="collect__checkbox" type="checkbox" checked={inIt.has(c.id)}
                                            disabled={inIt.has(c.id) && !mayTakeOut(c)}
                                            onChange={e => attempt(() => (e.currentTarget as HTMLInputElement).checked
                                                ? store.addToCollection(c.id, [documentId])
                                                : store.removeFromCollection(c.id, documentId))} />
                                        <span class="collect__name">{c.name ?? "Untitled collection"}</span>
                                        <span class="collect__meta">
                                            {c.documentIds.length} · {c.mine ? describeAudience(c.see, true, "see") : "shared with you"}
                                        </span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
                    <form class="collect__new" onSubmit={e => {
                        e.preventDefault();
                        if (!name.trim()) return;
                        attempt(async () => {
                            await store.createCollection(name, [documentId], see === "owner" ? { see: "owner", add: "owner" } : undefined);
                            setName("");
                            setSee("everyone");
                        });
                    }}>
                        <label class="collect__field">
                            New collection
                            <input class="collect__input" value={name} maxLength={80} placeholder="Name it"
                                onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                        </label>
                        <label class="collect__field collect__field--who">
                            Who can see it
                            <select class="collect__input" value={see} onChange={e => setSee((e.currentTarget as HTMLSelectElement).value as "everyone" | "owner")}>
                                <option value="everyone">Everyone</option>
                                <option value="owner">Only me</option>
                            </select>
                        </label>
                        <button class="collect__create" type="submit">Create</button>
                    </form>
                    <p class="collect__hint">Share it with chosen people or groups from the collection's own page.</p>
                </div>
            )}
        </section>
    );
}
