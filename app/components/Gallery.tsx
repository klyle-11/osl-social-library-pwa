import { medium, presence, query, views, viewer } from "../state";
import { listPeople } from "../format";
import { DocumentCard } from "./DocumentCard";

// Front page: every document in the library, newest first, narrowed by the header's controls.
export function Gallery() {
    const v = views.value;
    const me = viewer.value;
    const q = query.value.trim().toLowerCase();
    const kind = medium.value;

    const shown = v.documentOrder.filter(id => {
        const doc = v.documents[id];
        const p = doc.properties;
        if (kind !== "all" && p.type !== kind) return false;
        if (!q) return true;
        // notes are part of what a document is known by, so they are searched too
        const notes = (v.threads[id] ?? []).map(a => a.op.body).join(" ");
        return [p.title, p.subtitle, p.author, p.year, p.description, notes].join(" ").toLowerCase().includes(q);
    });

    const others = presence.value.online.map(p => p.user).filter(u => u !== me);
    return (
        <section class="gallery">
            <div class="gallery__bar">
                <h2 class="gallery__title">The library</h2>
                <p class="gallery__count">
                    {shown.length === v.documentOrder.length
                        ? `${shown.length} documents`
                        : `${shown.length} of ${v.documentOrder.length} documents`}
                </p>
                {others.length > 0 && (
                    <p class="gallery__people">
                        {listPeople(others, v.names)} {others.length === 1 ? "is" : "are"} also online.
                    </p>
                )}
            </div>
            {shown.length === 0 && (
                <p class="gallery__empty">
                    Nothing matches.{" "}
                    <button class="gallery__clear" type="button" onClick={() => { query.value = ""; medium.value = "all"; }}>Show everything</button>
                </p>
            )}
            <ul class="gallery__list">
                {shown.map(id => <li class="gallery__item" key={id}><DocumentCard id={id} /></li>)}
            </ul>
        </section>
    );
}
