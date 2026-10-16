import { useState } from "preact/hooks";
import { attempt, useLibrary, views, viewer } from "../state";
import { displayName } from "../format";
import { href } from "../route";
import type { CollectionView } from "../../core/views";
import { Thumbnail } from "./Thumbnail";
import { describeAudience } from "./Audience";

// Everyone's collections as shelves: a few covers each, what's in it, whose, and who can see it.
export function Collections() {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const [name, setName] = useState("");
    const [see, setSee] = useState<"everyone" | "owner">("everyone");
    const all = v.collectionOrder.map(id => v.collections[id]);
    const mine = all.filter(c => c.mine);
    // shared with me (not with everyone), then everyone's, the moment they're named: an emptied Kept is the only one left out
    const shared = all.filter(c => !c.mine && c.see.kind === "people");
    const others = all.filter(c => !c.mine && c.see.kind !== "people" && (c.documentIds.length > 0 || (c.name !== null && !c.id.endsWith("/kept"))));

    return (
        <section class="collections">
            <h2 class="collections__title">Collections</h2>

            <form class="collections__new" onSubmit={e => {
                e.preventDefault();
                if (!name.trim()) return;
                attempt(async () => {
                    const id = await store.createCollection(name, [], see === "owner" ? { see: "owner", add: "owner" } : undefined);
                    setName("");
                    setSee("everyone");
                    location.hash = href({ view: "collection", id });
                });
            }}>
                <label class="collections__new-label">
                    Start a collection
                    <input class="collections__new-input" value={name} maxLength={80} placeholder="Name it (you can change it later)"
                        onInput={e => setName((e.currentTarget as HTMLInputElement).value)} />
                </label>
                <label class="collections__new-label collections__new-label--who">
                    Who can see it
                    <select class="collections__new-input" value={see} onChange={e => setSee((e.currentTarget as HTMLSelectElement).value as "everyone" | "owner")}>
                        <option value="everyone">Everyone</option>
                        <option value="owner">Only me</option>
                    </select>
                </label>
                <button class="collections__new-button" type="submit">Create</button>
            </form>

            <Shelf title="Yours" list={mine} empty="Nothing yet. Tap Keep on anything in the library and it lands here." />
            {shared.length > 0 && <Shelf title="Shared with you" list={shared} empty="" />}
            <Shelf title="Everyone's" list={others} empty="No one else has made a collection yet." />
        </section>
    );

    function Shelf({ title, list, empty }: { title: string, list: CollectionView[], empty: string }) {
        return (
            <section class="collections__shelf">
                <h3 class="collections__heading">{title} <span class="collections__count">{list.length || ""}</span></h3>
                {list.length ? (
                    <ul class="collections__grid">
                        {list.map(c => {
                            const covers = c.documentIds.slice(-4).reverse().map(id => v.documents[id]).filter(Boolean);
                            return (
                                <li class="collections__card" key={c.id}>
                                    <a class="collections__link" href={href({ view: "collection", id: c.id })}>
                                        <span class={`collections__covers collections__covers--${Math.min(covers.length, 4)}`} aria-hidden="true">
                                            {covers.length
                                                ? covers.map(d => <Thumbnail doc={d} modifier="cover" key={d.id} />)
                                                : <span class="collections__covers-empty">Empty so far</span>}
                                        </span>
                                        <span class="collections__name">{c.name ?? "Untitled collection"}</span>
                                        <span class="collections__meta">
                                            {c.documentIds.length} {c.documentIds.length === 1 ? "document" : "documents"} · {c.mine ? "yours" : <>by {displayName(c.owner, v, me)}</>}
                                        </span>
                                        <span class={`collections__access collections__access--${c.see.kind}`}>{describeAudience(c.see, c.mine, "see")}</span>
                                    </a>
                                </li>
                            );
                        })}
                    </ul>
                ) : empty && <p class="collections__empty">{empty}</p>}
            </section>
        );
    }
}
