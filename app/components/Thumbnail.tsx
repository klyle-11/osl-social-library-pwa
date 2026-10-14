import { useEffect, useState } from "preact/hooks";
import type { LibraryDocument } from "../../core/types";
import { useLibrary } from "../state";
import { fileKind, fileUrl, mediumLabel } from "../format";

const KIND_WORD = { image: "Image", audio: "Audio", video: "Video", text: "Text", pdf: "PDF", link: "Link", file: "File" };

// An image if the document is one; otherwise a labelled tile, tinted by what kind of file it is.
export function Thumbnail({ doc, modifier }: { doc: LibraryDocument, modifier: string }) {
    const src = useImageSrc(doc);
    if (src) {
        return <img class={`thumbnail thumbnail--${modifier}`} src={src} alt={doc.properties.alt ?? ""} loading="lazy" />;
    }
    const kind = fileKind(doc.fileType);
    return (
        <div class={`thumbnail thumbnail--${modifier} thumbnail--placeholder thumbnail--${kind}`} aria-hidden="true">
            <span class="thumbnail__kind">{KIND_WORD[kind]}</span>
            <span class="thumbnail__label">{mediumLabel(doc.properties.type) || "Document"}</span>
        </div>
    );
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
