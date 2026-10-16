import { useEffect, useRef, useState } from "preact/hooks";
import { Epub } from "../../adapters/epub";
import { loadPlace, ReaderBar, savePlace, useFullScreen, useThumbnailBackfill } from "./reader";
import { imageThumbnail } from "../thumbnails";
import { theme } from "../theme";

const SIZES = [85, 100, 115, 130, 150, 175];

// Reads an EPUB in the page: one chapter at a time in a frame that runs no
// scripts, styled with the app's theme, and back where you left off next time.
export function EpubReader({ url, docId }: { url: string, docId: string }) {
    const [book, setBook] = useState<Epub | null>(null);
    const [failed, setFailed] = useState<string | null>(null);
    const [chapter, setChapter] = useState(0);
    const [src, setSrc] = useState<string | null>(null);
    const [size, setSize] = useState(1);
    const pending = useRef<{ fraction?: number, fragment?: string } | null>(null);
    const frame = useRef<HTMLIFrameElement>(null);
    const [full, toggleFull] = useFullScreen();
    useThumbnailBackfill(docId, !!book, async () => { const cover = await book!.coverImage(); return cover && imageThumbnail(cover); });
    // listeners inside the frame outlive a render: they read these
    const now = useRef({ chapter, size, full, toggleFull });
    now.current = { chapter, size, full, toggleFull };

    useEffect(() => {
        let live = true;
        let opened: Epub | null = null;
        (async () => {
            const res = await fetch(url);
            if (!res.ok) throw new Error(res.status === 404 ? "This book isn't at the library any more." : `couldn't load the book (${res.status})`);
            opened = await Epub.open(new Uint8Array(await res.arrayBuffer()));
            if (!live) return opened.close();
            const place = loadPlace(docId);
            const at = place && place.chapter < opened.spine.length ? place.chapter : 0;
            pending.current = { fraction: place?.fraction };
            setSize(place?.size ?? 1);
            setChapter(at);
            setBook(opened);
        })().catch(e => {
            if (live) setFailed(e instanceof TypeError ? "Not available offline. Keep it next time you're connected to carry it with you." : String(e.message ?? e));
        });
        return () => { live = false; opened?.close(); };
    }, [url]);

    useEffect(() => {
        if (!book) return;
        let live = true;
        book.chapter(chapter).then(u => { if (live) setSrc(u); }, e => { if (live) setFailed(String(e.message ?? e)); });
        return () => { live = false; };
    }, [book, chapter]);

    // restyle when the size or the theme changes, without reloading the chapter
    const themeId = theme.value;
    useEffect(() => { const d = frame.current?.contentDocument; if (d) style(d, SIZES[size]); }, [size, themeId]);

    function go(i: number, then: { fraction?: number, fragment?: string } = {}) {
        if (!book || i < 0 || i >= book.spine.length) return;
        pending.current = then;
        if (i === now.current.chapter) arrive(); else setChapter(i);
        savePlace(docId, { chapter: i, fraction: then.fraction ?? 0, size: now.current.size });
    }

    function follow(href: string) {
        if (!book) return;
        const i = book.indexOf(href);
        if (i >= 0) go(i, { fragment: href.split("#")[1] });
    }

    function arrive() {
        const f = frame.current;
        const d = f?.contentDocument, w = f?.contentWindow;
        if (!d || !w) return;
        const want = pending.current;
        pending.current = null;
        if (want?.fragment) d.getElementById(want.fragment)?.scrollIntoView();
        else {
            const s = d.scrollingElement ?? d.documentElement;
            w.scrollTo(0, (want?.fraction ?? 0) * (s.scrollHeight - s.clientHeight));
        }
    }

    function loaded() {
        const f = frame.current;
        const d = f?.contentDocument, w = f?.contentWindow;
        if (!d || !w) return;
        style(d, SIZES[now.current.size]);
        d.addEventListener("click", e => {
            const a = (e.target as Element).closest?.("a[href]");
            if (!a) return;
            e.preventDefault();
            const inBook = a.getAttribute("data-osl-href");
            if (inBook) follow(inBook);
            else window.open(a.getAttribute("href")!, "_blank", "noopener,noreferrer");
        });
        d.addEventListener("keydown", key);
        let t = 0;
        w.addEventListener("scroll", () => {
            clearTimeout(t);
            t = window.setTimeout(() => {
                const s = d.scrollingElement ?? d.documentElement;
                const range = s.scrollHeight - s.clientHeight;
                savePlace(docId, { chapter: now.current.chapter, fraction: range > 0 ? s.scrollTop / range : 0, size: now.current.size });
            }, 300);
        });
        // images arriving late change the height: wait for them before restoring the place
        Promise.all([...d.images].map(img => img.complete ? null : new Promise(r => { img.onload = img.onerror = r; }))).then(arrive);
    }

    function key(e: KeyboardEvent) {
        const { chapter, full, toggleFull } = now.current;
        if (e.key === "ArrowRight" && e.altKey) go(chapter + 1);
        if (e.key === "ArrowLeft" && e.altKey) go(chapter - 1);
        if (e.key === "Escape" && full) toggleFull();
    }

    if (failed) return <p class="document-viewer document-viewer--unavailable">{failed}</p>;
    if (!book) return <p class="document-viewer document-viewer--loading">Opening the book…</p>;

    const current = book.spine[chapter];
    const here = [...book.toc].reverse().find(t => t.href.split("#")[0] === current);

    return (
        <div class={`document-viewer reader reader--epub${full ? " reader--full" : ""}`} onKeyDown={key}>
            <ReaderBar full={full} onFull={toggleFull}>
                <button class="reader__button" type="button" onClick={() => go(chapter - 1)} disabled={chapter === 0} aria-label="Previous chapter">‹</button>
                {book.toc.length > 0 ? (
                    <select class="reader__toc" aria-label="Contents" value={here?.href ?? ""}
                        onChange={e => follow((e.currentTarget as HTMLSelectElement).value)}>
                        {!here && <option value="">Chapter {chapter + 1} of {book.spine.length}</option>}
                        {book.toc.map(t => <option value={t.href} key={t.href}>{" ".repeat(t.depth) + (t.label || "Untitled")}</option>)}
                    </select>
                ) : <span class="reader__where">Chapter {chapter + 1} of {book.spine.length}</span>}
                <button class="reader__button" type="button" onClick={() => go(chapter + 1)} disabled={chapter === book.spine.length - 1} aria-label="Next chapter">›</button>
                <span class="reader__gap" />
                <button class="reader__button" type="button" onClick={() => setSize(s => Math.max(0, s - 1))} disabled={size === 0} aria-label="Smaller text">A−</button>
                <button class="reader__button" type="button" onClick={() => setSize(s => Math.min(SIZES.length - 1, s + 1))} disabled={size === SIZES.length - 1} aria-label="Larger text">A+</button>
            </ReaderBar>
            {src && <iframe ref={frame} class="reader__page" src={src} sandbox="allow-same-origin" title={book.title || "Book"} onLoad={loaded} />}
            <div class="reader__foot">
                <button class="reader__next" type="button" onClick={() => go(chapter - 1)} disabled={chapter === 0}>← Previous chapter</button>
                <button class="reader__next" type="button" onClick={() => go(chapter + 1)} disabled={chapter === book.spine.length - 1}>Next chapter →</button>
            </div>
        </div>
    );
}

// the app's colours and a readable measure, laid over the book's own styles
function style(d: Document, percent: number) {
    const css = getComputedStyle(document.documentElement);
    const v = (name: string) => css.getPropertyValue(name).trim();
    let el: Element | null = d.getElementById("osl-reader-style");
    if (!el) {
        el = d.createElementNS(d.documentElement.namespaceURI, "style");
        el.id = "osl-reader-style";
        (d.head ?? d.documentElement).appendChild(el);
    }
    el.textContent = `
        html { background: ${v("--bg")}; color: ${v("--text")}; font-size: ${percent}%; color-scheme: ${css.colorScheme || "light"}; }
        body { max-width: 38em; margin: 0 auto !important; padding: 1.25rem 1.25rem 3rem !important; line-height: 1.6; font-family: ${v("--serif")}; background: transparent !important; color: inherit !important; }
        a { color: ${v("--link")}; }${dark(v("--bg")) ? `
        body * { color: inherit !important; background-color: transparent !important; border-color: ${v("--line")} !important; }` : ""}
        img, svg, video { max-width: 100% !important; height: auto !important; }
        pre { white-space: pre-wrap; }
    `;
}

// a book's own dark text would vanish on a dark theme: there, the theme's colours win everywhere
function dark(hex: string): boolean {
    const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})/i.exec(hex);
    if (!m) return false;
    const [r, g, b] = m.slice(1).map(x => parseInt(x, 16));
    return 0.299 * r + 0.587 * g + 0.114 * b < 128;
}
