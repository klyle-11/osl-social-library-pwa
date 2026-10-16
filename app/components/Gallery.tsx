import type { LibraryDocument } from "../../core/types";
import { format, medium, presence, query, sortBy, SORTS, views, viewer, type SortKey } from "../state";
import { FORMATS, displayName, formatLabel, formatOf, listPeople, mediumLabel } from "../format";
import { DocumentCard } from "./DocumentCard";

// Front page: every document in the library, narrowed by the header's search and
// kind and the bar's format, in the order chosen here (newest first unless changed).
export function Gallery() {
    const v = views.value;
    const me = viewer.value;
    const words = fold(query.value).split(/\s+/).filter(Boolean);
    const kind = medium.value;
    const fmt = format.value;
    const sort = sortBy.value;
    const uploader = (doc: LibraryDocument) => displayName(doc.user, v, me);

    const shown = v.documentOrder.filter(id => {
        const doc = v.documents[id];
        const p = doc.properties;
        if (kind !== "all" && p.type !== kind) return false;
        if (fmt !== "all" && formatOf(doc.fileType) !== fmt) return false;
        if (!words.length) return true;
        // every word somewhere: in its details, who added it, its format, its collections, or its notes
        const notes = (v.threads[id] ?? []).map(a => a.op.body);
        const collections = (v.collectionsByDocument[id] ?? []).map(c => v.collections[c]?.name ?? "");
        const text = fold([p.title, p.subtitle, p.author, p.year, p.description, mediumLabel(p.type),
            formatLabel(doc.fileType), uploader(doc), ...collections, ...notes].join(" "));
        return words.every(w => text.includes(w));
    });

    const ordered = sortDocuments(shown.map(id => v.documents[id]), sort, uploader).map(d => d.id);
    const formats = FORMATS.filter(([f]) => Object.values(v.documents).some(d => formatOf(d.fileType) === f));
    const narrowed = words.length > 0 || kind !== "all" || fmt !== "all";
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
                <div class="gallery__controls">
                    <label class="gallery__control">
                        <span class="gallery__control-label">Format</span>
                        <select class="gallery__select" value={fmt} onChange={e => { format.value = (e.currentTarget as HTMLSelectElement).value; }}>
                            <option value="all">All formats</option>
                            {formats.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                    <label class="gallery__control">
                        <span class="gallery__control-label">Sort</span>
                        <select class="gallery__select" value={sort} onChange={e => {
                            sortBy.value = (e.currentTarget as HTMLSelectElement).value as SortKey;
                            try { localStorage.setItem("osl-sort", sortBy.value); } catch { /* remembered for this visit only */ }
                        }}>
                            {SORTS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                        </select>
                    </label>
                    {narrowed && <button class="gallery__clear" type="button" onClick={clear}>Clear filters</button>}
                </div>
                {others.length > 0 && (
                    <p class="gallery__people">
                        {listPeople(others, v)} {others.length === 1 ? "is" : "are"} also online.
                    </p>
                )}
            </div>
            {shown.length === 0 && (
                <p class="gallery__empty">
                    Nothing matches.{" "}
                    <button class="gallery__clear" type="button" onClick={clear}>Show everything</button>
                </p>
            )}
            <ul class="gallery__list">
                {ordered.map(id => <li class="gallery__item" key={id}><DocumentCard id={id} /></li>)}
            </ul>
        </section>
    );
}

function clear() {
    query.value = "";
    medium.value = "all";
    format.value = "all";
}

// lower case, without accents: "Café" is found by "cafe"
function fold(s: string): string {
    return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

// "The Souls of Black Folk" files under S, as on a library shelf
function titleKey(title: string): string {
    return title.replace(/^[\s"'“‘(\[]+/, "").replace(/^(the|a|an)\s+/i, "");
}

// the small words that belong to a surname: "W. E. B. Du Bois" files under D
const PARTICLES = new Set(["de", "da", "di", "del", "della", "des", "du", "la", "le", "van", "von", "der", "den", "ter", "st.", "mac", "bin", "ibn", "al"]);

// by surname: "Paul Laurence Dunbar" under D; "Dunbar, Paul" already is; the first of several authors
function authorKey(author: string): string {
    const first = author.split(/\s*(?:;|&|\band\b)\s*/i)[0].trim();
    if (first.includes(",")) return first;
    const parts = first.split(/\s+/);
    if (parts.length < 2) return first;
    let at = parts.length - 1;
    while (at > 1 && PARTICLES.has(parts[at - 1].toLowerCase())) at--;
    return `${parts.slice(at).join(" ")}, ${parts.slice(0, at).join(" ")}`;
}

export function sortDocuments(docs: LibraryDocument[], sort: SortKey, uploader: (d: LibraryDocument) => string): LibraryDocument[] {
    const newest = (a: LibraryDocument, b: LibraryDocument) => b.timestamp.localeCompare(a.timestamp) || (a.id < b.id ? 1 : -1);
    const by = (key: (d: LibraryDocument) => string, down: boolean) => (a: LibraryDocument, b: LibraryDocument) => {
        const ka = key(a), kb = key(b);
        if (!ka !== !kb) return ka ? -1 : 1;           // missing (no author) last, either way
        return (down ? -1 : 1) * collator.compare(ka, kb) || collator.compare(titleKey(a.properties.title), titleKey(b.properties.title)) || newest(a, b);
    };
    const compare = {
        "newest": newest,
        "oldest": (a: LibraryDocument, b: LibraryDocument) => newest(b, a),
        "title-az": by(d => titleKey(d.properties.title), false),
        "title-za": by(d => titleKey(d.properties.title), true),
        "author-az": by(d => authorKey(d.properties.author ?? ""), false),
        "author-za": by(d => authorKey(d.properties.author ?? ""), true),
        "uploader-az": by(uploader, false),
        "uploader-za": by(uploader, true)
    }[sort];
    return [...docs].sort(compare);
}
