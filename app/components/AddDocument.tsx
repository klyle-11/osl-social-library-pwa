import { useState } from "preact/hooks";
import type { DocumentMedium } from "../../core/types";
import { hashData, shrinkImage } from "../../adapters/media";
import { attempt, tell, tokens, useLibrary, useTransport } from "../state";
import { MEDIUMS } from "../format";
import { href } from "../route";

const STATION_KINDS: [string, DocumentMedium][] = [["video/", "film"], ["audio/", "audio"], ["image/", "photo"]];

// Anyone can add to the library: a photo, a link, or just a description.
// The paired digitization station can also send whole files: scans, audio, film.
export function AddDocument() {
    const store = useLibrary();
    const transport = useTransport();
    const station = tokens.value.station;
    const [progress, setProgress] = useState<number | null>(null);
    const [title, setTitle] = useState("");
    const [author, setAuthor] = useState("");
    const [type, setType] = useState<DocumentMedium>("");
    const [year, setYear] = useState("");
    const [description, setDescription] = useState("");
    const [alt, setAlt] = useState("");
    const [url, setUrl] = useState("");
    const [photo, setPhoto] = useState<File | null>(null);
    const [busy, setBusy] = useState(false);

    const text = (set: (v: string) => void) => (e: Event) => set((e.currentTarget as HTMLInputElement).value);

    async function submit(e: Event) {
        e.preventDefault();
        if (!title.trim() || busy) return;
        setBusy(true);
        await attempt(async () => {
            let hash: string | undefined;
            let fileType = url.trim() ? "link" : "text";
            if (photo && station) {
                // the station's files go to the library whole and untouched
                const saved = await transport.upload(photo, station, setProgress);
                hash = saved.hash;
                fileType = saved.fileType;
            } else if (photo) {
                const data = await shrinkImage(photo);
                hash = await hashData(data);
                await store.putMedia(hash, data);
                fileType = data.slice(5, data.indexOf(";"));   // "data:image/jpeg;base64,…"
            }
            const properties = {
                title: title.trim(), author: author.trim(), type,
                ...(year.trim() && { year: year.trim() }),
                ...(description.trim() && { description: description.trim() }),
                ...(alt.trim() && { alt: alt.trim() })
            };
            const id = await store.addDocument({
                fileType, properties,
                ...(hash && { hash }),
                ...(!photo && url.trim() && { url: url.trim() })
            });
            tell("Added to the library.");
            location.hash = href({ view: "document", id });
        });
        setBusy(false);
        setProgress(null);
    }

    function choose(file: File | null) {
        setPhoto(file);
        if (!file || !station) return;
        // a head start on the form: the filename as a title, and the kind from the file's type
        if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
        const guess = STATION_KINDS.find(([prefix]) => file.type.startsWith(prefix));
        if (guess && !type) setType(guess[1]);
    }

    return (
        <form class="add-document" onSubmit={submit}>
            <h2 class="add-document__title">Add to the library</h2>
            {station && <p class="add-document__station">This computer is the digitization station: scans, audio and film upload whole.</p>}
            <label class="add-document__field">
                {station ? "File (image, PDF, audio or video)" : "Photo"}
                <input class="add-document__input" type="file"
                    accept={station ? "image/*,audio/*,video/*,application/pdf,text/plain,.epub" : "image/*"}
                    onChange={e => choose((e.currentTarget as HTMLInputElement).files?.[0] ?? null)} />
            </label>
            {photo && photo.type.startsWith("image/") && (
                <label class="add-document__field">
                    Describe the photo for someone who can't see it
                    <textarea class="add-document__input" value={alt} maxLength={1000} rows={2} onInput={text(setAlt)} />
                </label>
            )}
            <label class="add-document__field">
                Title (required)
                <input class="add-document__input" value={title} maxLength={200} required onInput={text(setTitle)} />
            </label>
            <label class="add-document__field">
                By
                <input class="add-document__input" value={author} maxLength={200} onInput={text(setAuthor)} />
            </label>
            <label class="add-document__field">
                Kind
                <select class="add-document__input" value={type}
                    onChange={e => setType((e.currentTarget as HTMLSelectElement).value as DocumentMedium)}>
                    {MEDIUMS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                </select>
            </label>
            <label class="add-document__field">
                Year
                <input class="add-document__input" value={year} maxLength={20} inputMode="numeric" onInput={text(setYear)} />
            </label>
            <label class="add-document__field">
                About it
                <textarea class="add-document__input" value={description} maxLength={1000} rows={3} onInput={text(setDescription)} />
            </label>
            {!photo && (
                <label class="add-document__field">
                    Link (optional)
                    <input class="add-document__input" type="url" value={url} maxLength={2000} onInput={text(setUrl)} />
                </label>
            )}
            {progress !== null && (
                <label class="add-document__progress">
                    Uploading… {Math.round(progress * 100)}%
                    <progress class="add-document__bar" value={progress} max={1} />
                </label>
            )}
            <button class="add-document__submit" type="submit" disabled={busy}>{busy ? "Adding…" : "Add"}</button>
        </form>
    );
}
