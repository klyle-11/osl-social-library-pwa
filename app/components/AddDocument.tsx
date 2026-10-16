import { useState } from "preact/hooks";
import type { DocumentMedium } from "../../core/types";
import { hashData, shrinkImage } from "../../adapters/media";
import { fileTypeOf } from "../../adapters/http-transport";
import { Epub } from "../../adapters/epub";
import { thumbnailOf } from "../thumbnails";
import { attempt, directory, nodeRole, tell, tokens, useLibrary, useTransport } from "../state";
import { MEDIUMS } from "../format";
import { href } from "../route";

const KINDS: [string, DocumentMedium][] = [["video/", "film"], ["audio/", "audio"], ["image/", "photo"]];

// Anyone can add to the library: any file, a link, or just a description.
// A photo taken on a phone is shrunk and kept on the phone until it syncs, so it
// can be added anywhere, a drop point included. Every other file goes to the
// library whole, so it needs the library's Wi-Fi. The paired digitization
// station sends its photos (scans) whole too.
export function AddDocument() {
    const store = useLibrary();
    const transport = useTransport();
    const station = tokens.value.station;
    const whole = (f: File) => !!station || !f.type.startsWith("image/") || f.type === "image/svg+xml";
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
    const [editors, setEditors] = useState<"everyone" | "owner">("everyone");

    const text = (set: (v: string) => void) => (e: Event) => set((e.currentTarget as HTMLInputElement).value);

    async function submit(e: Event) {
        e.preventDefault();
        if (!title.trim() || busy) return;
        setBusy(true);
        await attempt(async () => {
            let hash: string | undefined;
            let thumbnail: string | undefined;
            let fileType = url.trim() ? "link" : "text";
            if (photo && whole(photo)) {
                // whole files go to the library untouched, so they need to reach it now
                if (nodeRole.value === "droppoint") throw new Error("Files go straight to the library, so add this one when you're on the library's Wi-Fi. Photos can be added here.");
                const small = await thumbnailOf(photo);   // the first page, the cover, a frame
                const saved = await transport.upload(photo, setProgress);
                hash = saved.hash;
                fileType = saved.fileType;
                if (small) {
                    thumbnail = await transport.upload(new File([small], "thumbnail.jpg", { type: "image/jpeg" }), () => {})
                        .then(t => t.hash, () => undefined);   // the document matters; its picture can come later
                }
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
                ...(alt.trim() && { alt: alt.trim() }),
                ...(thumbnail && { thumbnail }),
                ...(editors !== "everyone" && { editors })
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

    function choose(input: HTMLInputElement) {
        const file = input.files?.[0] ?? null;
        setPhoto(file);
        if (!file || !whole(file)) return;
        // a head start on the form: the filename as a title, and the kind from the file's type
        if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " "));
        const guess = KINDS.find(([prefix]) => file.type.startsWith(prefix));
        if (guess && !type) setType(guess[1]);
        if (fileTypeOf(file) === "application/epub+zip") {
            if (!type) setType("book");
            // a book knows its own title and author
            file.arrayBuffer().then(b => Epub.open(new Uint8Array(b))).then(book => {
                if (book.title) setTitle(t => t && t !== file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ") ? t : book.title);
                if (book.author) setAuthor(a => a || book.author);
                book.close();
            }, () => { /* the library will say if it's damaged when someone opens it */ });
        }
    }

    // the library says who may add documents (W-D12); the node checks it too
    const d = directory.value;
    if (d && d.library.mayUpload === false) {
        return (
            <section class="add-document">
                <h2 class="add-document__title">Add to the library</h2>
                <p class="add-document__closed">
                    Adding documents to {d.library.name} is for {whoMayAdd(d.library.upload ?? [])}.
                    {!d.me && <> If that's you, <a href={href({ view: "account" })}>sign in</a>.</>}
                    {" "}You can still keep, collect and write notes on everything here.
                </p>
            </section>
        );
    }

    return (
        <form class="add-document" onSubmit={submit}>
            <h2 class="add-document__title">Add to the library</h2>
            {station && <p class="add-document__station">This computer is the digitization station: photos and scans upload whole, at full size.</p>}
            <label class="add-document__field">
                File (a photo, PDF, EPUB, audio, video, or anything else)
                <input class="add-document__input" type="file"
                    onChange={e => choose(e.currentTarget as HTMLInputElement)} />
            </label>
            {photo && whole(photo) && (
                <p class="add-document__note">
                    {nodeRole.value === "droppoint"
                        ? "Files go straight to the library: add this one when you're on the library's Wi-Fi. Photos can be added here."
                        : "This goes to the library whole, so everyone can open it."}
                </p>
            )}
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
            <label class="add-document__field">
                Who can change its details later
                <select class="add-document__input" value={editors}
                    onChange={e => setEditors((e.currentTarget as HTMLSelectElement).value as "everyone" | "owner")}>
                    <option value="everyone">Everyone (you can change this)</option>
                    <option value="owner">Only me (you can open it up later)</option>
                </select>
            </label>
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

function whoMayAdd(upload: string[]): string {
    const words: Record<string, string> = {
        accounts: "anyone signed in", members: "people with a role here", uploaders: "uploaders",
        digitizers: "digitizers", presenters: "presenters"
    };
    const list = ["its admins and stewards", ...upload.map(u => words[u]).filter(Boolean)];
    return list.length === 1 ? list[0] : `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}
