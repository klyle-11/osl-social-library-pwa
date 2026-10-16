import { useEffect, useState } from "preact/hooks";
import type { LibraryDocument } from "../../core/types";
import { fileUrl } from "../format";
import { useImageSrc } from "./Thumbnail";
import { PdfReader } from "./PdfReader";
import { EpubReader } from "./EpubReader";
import { useThumbnailBackfill } from "./reader";
import { videoThumbnail } from "../thumbnails";

// Shows the document itself, by kind. Mostly plain browser elements (img, audio,
// video) so it keeps working offline once carried; PDFs and EPUBs get a reader.
export function DocumentViewer({ doc }: { doc: LibraryDocument }) {
    const url = fileUrl(doc);
    const image = useImageSrc(doc);
    const t = doc.fileType;

    if (t === "link") {
        return (
            <div class="document-viewer document-viewer--link">
                <a class="document-viewer__open" href={doc.url} target="_blank" rel="noopener noreferrer">Open link</a>
                <p class="document-viewer__note">Links need a connection.</p>
            </div>
        );
    }
    if (image) return <div class="document-viewer document-viewer--image"><img class="document-viewer__image" src={image} alt={doc.properties.alt ?? ""} /></div>;
    if (!url) return null;
    // plain text, markdown, csv… shown as text; a web page someone uploaded is only a download
    if (t.startsWith("text/") && t !== "text/html") return <TextViewer url={url} />;
    if (t.startsWith("audio/")) return <div class="document-viewer document-viewer--audio"><audio class="document-viewer__audio" src={url} controls preload="metadata" /></div>;
    if (t.startsWith("video/")) return <VideoViewer key={url} url={url} docId={doc.id} />;
    if (t === "application/pdf") return <PdfReader key={url} url={url} docId={doc.id} />;
    if (t === "application/epub+zip") return <EpubReader key={url} url={url} docId={doc.id} />;
    return (
        <div class="document-viewer document-viewer--file">
            <a class="document-viewer__open" href={url} download>Download file</a>
        </div>
    );
}

function VideoViewer({ url, docId }: { url: string, docId: string }) {
    useThumbnailBackfill(docId, true, () => videoThumbnail(new URL(url, document.baseURI).href));
    return <div class="document-viewer document-viewer--video"><video class="document-viewer__video" src={url} controls preload="metadata" playsInline /></div>;
}

function TextViewer({ url }: { url: string }) {
    const [text, setText] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    useEffect(() => {
        let live = true;
        fetch(url)
            .then(r => { if (!r.ok) throw new Error(String(r.status)); return r.text(); })
            .then(t => { if (live) setText(t); })
            .catch(() => { if (live) setFailed(true); });
        return () => { live = false; };
    }, [url]);
    if (failed) return <p class="document-viewer document-viewer--unavailable">Not available offline. Keep it next time you're connected to carry it with you.</p>;
    if (text === null) return <p class="document-viewer document-viewer--loading">Loading…</p>;
    return <div class="document-viewer document-viewer--text"><pre class="document-viewer__text">{text}</pre></div>;
}
