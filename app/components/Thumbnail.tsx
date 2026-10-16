import { useEffect, useState } from "preact/hooks";
import type { LibraryDocument } from "../../core/types";
import { useLibrary } from "../state";
import { fileKind, fileUrl, mediumLabel } from "../format";

const KIND_WORD = { image: "Image", audio: "Audio", video: "Video", text: "Text", pdf: "PDF", epub: "EPUB", link: "Link", file: "File" };

// An image if the document is one; otherwise a labelled tile, tinted by what kind of file it is.
export function Thumbnail({ doc, modifier }: { doc: LibraryDocument, modifier: string }) {
    const image = useImageSrc(doc);
    const [broken, setBroken] = useState<string | null>(null);
    const made = thumbnailUrl(doc);
    const src = made ?? image;
    // offline, a thumbnail that wasn't carried can't load: show the tile instead of a broken picture
    if (src && src !== broken) {
        return <img class={`thumbnail thumbnail--${modifier}${made && !doc.fileType.startsWith("image/") ? " thumbnail--page" : ""}`} src={src} alt={doc.properties.alt ?? ""} loading="lazy" onError={() => setBroken(src)} />;
    }
    const kind = fileKind(doc.fileType);
    return (
        <div class={`thumbnail thumbnail--${modifier} thumbnail--placeholder thumbnail--${kind}`} aria-hidden="true">
            <span class="thumbnail__kind">{KIND_WORD[kind]}</span>
            <span class="thumbnail__label">{mediumLabel(doc.properties.type) || "Document"}</span>
        </div>
    );
}

const HASH = /^(sha256-[0-9a-f]{64}|fnv1a-[0-9a-f]{8}-[0-9a-f]+)$/;

// the small picture made when it was added (or first opened), if it has one
export function thumbnailUrl(doc: LibraryDocument): string | null {
    const t = doc.properties.thumbnail;
    return t && HASH.test(t) ? `media/${t}` : null;
}

// photos added on this phone live in local storage; everything else is a url
export function useImageSrc(doc: LibraryDocument): string | null {
    const store = useLibrary();
    const isImage = doc.fileType.startsWith("image/");
    const [local, setLocal] = useState<string | null>(null);
    useEffect(() => {
        if (!isImage || !doc.hash || doc.url) return;
        let live = true;
        store.getMedia(doc.hash).then(d => { if (live && d) setLocal(d); });
        return () => { live = false; };
    }, [doc.id]);
    if (!isImage) return null;
    return local ?? fileUrl(doc);
}
