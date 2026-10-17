import { useEffect, useRef, useState } from "preact/hooks";
import type { LibraryDocument } from "../../core/types";
import { fileUrl } from "../format";
import { useImageSrc } from "./Thumbnail";
import { PdfReader } from "./PdfReader";
import { EpubReader } from "./EpubReader";
import { useThumbnailBackfill } from "./reader";
import { videoThumbnail } from "../thumbnails";
import { AudioButtons } from "./AudioBar";
import { clock, duration, nowPlaying, position } from "../player";
import { onPinch, usePinchZoom } from "../pinch";

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
    if (image) return <ImageViewer key={image} src={image} alt={doc.properties.alt ?? ""} />;
    if (!url) return null;
    // plain text, markdown, csv… shown as text; a web page someone uploaded is only a download
    if (t.startsWith("text/") && t !== "text/html") return <TextViewer url={url} />;
    if (t.startsWith("audio/")) return <AudioViewer doc={doc} />;
    if (t.startsWith("video/")) return <VideoViewer key={url} url={url} docId={doc.id} />;
    if (t === "application/pdf") return <PdfReader key={url} url={url} docId={doc.id} />;
    if (t === "application/epub+zip") return <EpubReader key={url} url={url} docId={doc.id} />;
    return (
        <div class="document-viewer document-viewer--file">
            <a class="document-viewer__open" href={url} download>Download file</a>
        </div>
    );
}

// A recording plays in the player along the bottom, so it keeps going while people look around.
function AudioViewer({ doc }: { doc: LibraryDocument }) {
    const here = nowPlaying.value === doc.id;
    return (
        <div class="document-viewer document-viewer--audio">
            <p class="document-viewer__audio-title">{doc.properties.title}</p>
            <AudioButtons id={doc.id} large />
            <p class="document-viewer__note">
                {here ? `${clock(position.value)}${duration.value ? ` of ${clock(duration.value)}` : ""} · playing along the bottom of the screen`
                    : "It plays along the bottom of the screen, and keeps playing while you look around."}
            </p>
        </div>
    );
}

function VideoViewer({ url, docId }: { url: string, docId: string }) {
    useThumbnailBackfill(docId, true, () => videoThumbnail(new URL(url, document.baseURI).href));
    return <div class="document-viewer document-viewer--video"><video class="document-viewer__video" src={url} controls preload="metadata" playsInline /></div>;
}

// A photo or a scan: two fingers zoom it, one moves around it once it's bigger than the box.
function ImageViewer({ src, alt }: { src: string, alt: string }) {
    const box = useRef<HTMLDivElement>(null);
    const img = useRef<HTMLImageElement>(null);
    const [zoom, setZoom] = useState(1);
    const fitted = useRef({ width: 0, height: 0 });   // its size at zoom 1, which zooming multiplies
    usePinchZoom({
        scroller: box, content: img, zoom, min: 1, max: 8,
        set: z => {
            const i = img.current;
            if (zoom === 1 && i) fitted.current = { width: i.clientWidth, height: i.clientHeight };
            setZoom(z);
        },
        under: () => img.current,
    });
    const size = zoom > 1 && fitted.current.width
        ? { width: `${fitted.current.width * zoom}px`, height: `${fitted.current.height * zoom}px`, maxWidth: "none", maxHeight: "none" }
        : undefined;
    return (
        <div class={`document-viewer document-viewer--image${size ? " document-viewer--zoomed" : ""}`} ref={box}
            style={size ? { height: `${fitted.current.height}px` } : undefined}>
            <img class="document-viewer__image" ref={img} src={src} alt={alt} style={size} />
        </div>
    );
}

const TEXT_MIN = 0.6, TEXT_MAX = 3;

// Plain text, markdown, csv: two fingers make the type bigger or smaller, and it rewraps.
function TextViewer({ url }: { url: string }) {
    const [text, setText] = useState<string | null>(null);
    const [failed, setFailed] = useState(false);
    const [size, setSize] = useState(1);
    const box = useRef<HTMLDivElement>(null);
    const pre = useRef<HTMLPreElement>(null);
    const now = useRef(size);
    now.current = size;
    const ready = text !== null;
    useEffect(() => {
        const b = box.current;
        if (!b) return;
        let at = 0;   // how far down the text the reader was, kept while it rewraps
        let pinching = false;
        const apply = (s: number) => {
            if (!pinching) { pinching = true; at = b.scrollTop / Math.max(1, b.scrollHeight - b.clientHeight); }
            pre.current?.style.setProperty("--text-zoom", String(s));
            b.scrollTop = at * (b.scrollHeight - b.clientHeight);
        };
        const fit = (s: number) => Math.min(TEXT_MAX, Math.max(TEXT_MIN, now.current * s));
        return onPinch(b, {
            move: s => apply(fit(s)),
            end: s => { apply(fit(s)); pinching = false; setSize(fit(s)); },
        });
    }, [ready]);
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
    return (
        <div class="document-viewer document-viewer--text" ref={box}>
            <pre class="document-viewer__text" ref={pre} style={{ "--text-zoom": String(size) }}>{text}</pre>
        </div>
    );
}
