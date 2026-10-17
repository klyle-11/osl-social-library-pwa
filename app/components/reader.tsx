import type { ComponentChildren } from "preact";
import { useEffect, useRef, useState } from "preact/hooks";
import { nodeRole, useLibrary, useTransport, views } from "../state";

// What the PDF and EPUB readers share: where you were, the toolbar, and full screen.

// a PDF's zoom is scale (1 = as wide as the reader); zoom was the step of its buttons, before pinching
export interface Place { chapter: number, fraction: number, size?: number, page?: number, scale?: number, zoom?: number }

// kept on this device only: where someone stopped reading isn't anyone else's business
export function loadPlace(docId: string): Place | null {
    try {
        const raw = localStorage.getItem("osl-place-" + docId);
        return raw ? JSON.parse(raw) as Place : null;
    } catch {
        return null;
    }
}

export function savePlace(docId: string, place: Place) {
    try { localStorage.setItem("osl-place-" + docId, JSON.stringify(place)); } catch { /* private window: forget it */ }
}

// Full screen is a class, not the Fullscreen API: iPhones don't have that API for
// anything but video, and this way the reader looks the same everywhere.
// Opening it adds a step to the browser's history, so the phone's own back button
// (or swipe) closes it rather than leaving the document.
export function useFullScreen(): [boolean, () => void] {
    const [full, setFull] = useState(false);
    useEffect(() => {
        document.documentElement.classList.toggle("reader-open", full);
        if (!full) return () => document.documentElement.classList.remove("reader-open");
        history.pushState({ oslReader: true }, "");
        const back = () => setFull(false);
        addEventListener("popstate", back);
        return () => {
            removeEventListener("popstate", back);
            document.documentElement.classList.remove("reader-open");
            // closed by a button, not by going back: take our step out of the history again
            if (history.state?.oslReader) history.back();
        };
    }, [full]);
    return [full, () => setFull(f => !f)];
}

export function ReaderBar({ full, onFull, children }: { full: boolean, onFull: () => void, children: ComponentChildren }) {
    return (
        <div class="reader__bar" role="toolbar">
            {full && <button class="reader__button reader__button--back" type="button" onClick={onFull}>← Back</button>}
            {children}
            {!full && <button class="reader__button reader__button--full" type="button" onClick={onFull}>Full screen</button>}
        </div>
    );
}

// Documents added before thumbnails existed (or from a device that couldn't make
// one) get theirs the first time someone opens them at the library: the reader has
// the file in hand already. Tried once per visit; if two people race, the later wins.
export function useThumbnailBackfill(docId: string, ready: boolean, make: () => Promise<Blob | null>) {
    const store = useLibrary();
    const transport = useTransport();
    const maker = useRef(make);
    maker.current = make;
    useEffect(() => {
        if (!ready) return;
        const doc = views.value.documents[docId];
        if (!doc || doc.properties.thumbnail || nodeRole.value !== "library") return;
        try {
            const key = "osl-thumbnail-tried-" + docId;
            if (sessionStorage.getItem(key)) return;
            sessionStorage.setItem(key, "1");
        } catch { /* storage blocked: try anyway */ }
        (async () => {
            const small = await maker.current();
            if (!small) return;
            const saved = await transport.upload(new File([small], "thumbnail.jpg", { type: "image/jpeg" }), () => {});
            await store.describe(docId, { thumbnail: saved.hash });
        })().catch(() => { /* offline or refused: the gallery keeps its tile */ });
    }, [docId, ready]);
}
