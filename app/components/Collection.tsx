import { useEffect, useState } from "preact/hooks";
import { KEPT_NAME } from "../../core/views";
import { formatAudience } from "../../core/access";
import { attempt, person, tell, useLibrary, views, viewer } from "../state";
import { displayName } from "../format";
import { DocumentCard } from "./DocumentCard";
import { AudiencePicker, describeAudience } from "./Audience";
import { canCarry } from "../../adapters/carry";

export function Collection({ id }: { id: string }) {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const c = v.collections[id];
    const [editing, setEditing] = useState(false);
    const [sharing, setSharing] = useState(false);
    const [name, setName] = useState("");

    if (!c) return <p class="collection collection--empty">This collection is empty, or isn't shared with you.</p>;
    const mine = c.mine;
    const kept = id.endsWith("/kept");
    const renamable = mine && !kept;
    // in someone else's collection, only what you put there can you take out
    const mayRemove = (docId: string) => {
        const by = c.addedBy[docId];
        return mine || (!!by && (v.devices[by] ?? by) === person.value);
    };

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
                <p class="collection__by">
                    {mine ? "Yours" : <>by <span class="mark">{displayName(c.owner, v, me)}</span></>} · {c.documentIds.length} {c.documentIds.length === 1 ? "document" : "documents"}
                </p>
                <p class="collection__access">
                    <span class={`collections__access collections__access--${c.see.kind}`}>{describeAudience(c.see, mine, "see")}</span>
                    {" · "}{c.mayAdd && !mine ? "You can add to it" : describeAudience(c.add, mine, "add")}
                </p>
                <div class="collection__tools">
                    {renamable && !editing && (
                        <button class="collection__rename-open" type="button"
                            onClick={() => { setName(c.name ?? ""); setEditing(true); }}>{c.name ? "Rename" : "Name it"}</button>
                    )}
                    {mine && !kept && (
                        <button class="collection__share-open" type="button" aria-expanded={sharing} onClick={() => setSharing(!sharing)}>
                            {sharing ? "Close sharing" : "Sharing"}
                        </button>
                    )}
                </div>
                {sharing && <Sharing id={id} done={() => setSharing(false)} />}
                {mine && (canCarry()
                    ? <p class="collection__carry">{c.name === KEPT_NAME ? "Everything you keep" : "Everything here"} is saved on this phone for offline use.</p>
                    : <p class="collection__carry">Saving copies on this phone for offline use needs the library's secure address (https), which comes with the domain.</p>)}
            </header>

            {c.documentIds.length ? (
                <ul class="collection__list">
                    {c.documentIds.map(docId => (
                        <li class="collection__item" key={docId}>
                            <DocumentCard id={docId}
                                onRemove={mayRemove(docId) ? () => attempt(() => store.removeFromCollection(id, docId)) : undefined} />
                        </li>
                    ))}
                </ul>
            ) : <p class="collection__empty">{c.mayAdd ? "Nothing in here yet. Add documents from their own pages." : "Nothing in here yet."}</p>}
        </section>
    );
}

// The owner's say: who may see it, and who may add to it.
function Sharing({ id, done }: { id: string, done: () => void }) {
    const store = useLibrary();
    const c = views.value.collections[id];
    const [see, setSee] = useState(formatAudience(c.see));
    const [add, setAdd] = useState(formatAudience(c.add));
    useEffect(() => { setSee(formatAudience(c.see)); setAdd(formatAudience(c.add)); }, [id]);
    const changed = see !== formatAudience(c.see) || add !== formatAudience(c.add);
    return (
        <form class="collection__sharing" onSubmit={e => {
            e.preventDefault();
            attempt(async () => {
                await store.setCollectionAccess(id, see, add);
                tell("Saved. It takes effect on every device as it syncs.");
                done();
            });
        }}>
            <AudiencePicker legend="Who can see it" what="see" value={see} onChange={setSee} />
            <AudiencePicker legend="Who can add to it" what="add" value={add} onChange={setAdd} />
            <p class="collection__sharing-note">
                Whoever adds a document can take it out again; you can take out anything. A collection that isn't for
                everyone stays at the library: it isn't sent to drop points.
            </p>
            <button class="collection__sharing-save" type="submit" disabled={!changed}>Save</button>
        </form>
    );
}
