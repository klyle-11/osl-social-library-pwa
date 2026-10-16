import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import { pdfjs, pdfjsAssets, type PdfJs } from "../pdfjs";
import { loadPlace, ReaderBar, savePlace, useFullScreen, useThumbnailBackfill } from "./reader";
import { pdfThumbnail } from "../thumbnails";

const ZOOMS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];   // 1 = the page as wide as the reader
const MAX_PIXELS = 16_000_000;                   // phones refuse bigger canvases

// Reads a PDF in the page, every page drawn by pdf.js: Android's browser can't
// show a PDF inside a page at all, and an iPhone shows only the first page.
export function PdfReader({ url, docId }: { url: string, docId: string }) {
    const [pdf, setPdf] = useState<PdfJs.PDFDocumentProxy | null>(null);
    const [aspects, setAspects] = useState<number[]>([]);   // height / width, per page
    const [failed, setFailed] = useState<string | null>(null);
    const [progress, setProgress] = useState(0);
    const [zoom, setZoom] = useState(2);
    const [page, setPage] = useState(1);
    const [width, setWidth] = useState(0);
    const [full, toggleFull] = useFullScreen();
    const scroller = useRef<HTMLDivElement>(null);
    const restore = useRef<number | null>(null);
    const timer = useRef(0);
    useThumbnailBackfill(docId, !!pdf, () => pdfThumbnail({ pdf: pdf! }));   // the first page is the cover

    useEffect(() => {
        let live = true;
        let task: PdfJs.PDFDocumentLoadingTask | null = null;
        (async () => {
            const lib = await pdfjs();
            task = lib.getDocument({ url: new URL(url, document.baseURI).href, ...pdfjsAssets() });
            task.onProgress = (p: { loaded: number, total: number }) => { if (live && p.total) setProgress(p.loaded / p.total); };
            const doc = await task.promise;
            if (!live) return;
            const first = (await doc.getPage(1)).getViewport({ scale: 1 });
            const place = loadPlace(docId);
            setAspects(Array(doc.numPages).fill(first.height / first.width));
            setZoom(place?.zoom !== undefined && place.zoom < ZOOMS.length ? place.zoom : 2);
            restore.current = place?.page && place.page <= doc.numPages ? place.page : null;
            setPdf(doc);
            // the real size of every page, for documents that mix them
            for (let i = 2; i <= doc.numPages && live; i++) {
                const v = (await doc.getPage(i)).getViewport({ scale: 1 });
                const a = v.height / v.width;
                if (Math.abs(a - first.height / first.width) > 0.01) setAspects(old => { const next = [...old]; next[i - 1] = a; return next; });
            }
        })().catch(e => {
            if (!live) return;
            const offline = e instanceof TypeError || /fetch|network/i.test(String(e?.message));
            setFailed(offline ? "Not available offline. Keep it next time you're connected to carry it with you."
                : e?.name === "PasswordException" ? "This PDF is locked with a password and can't be opened here."
                : `This PDF couldn't be opened (${e?.message ?? e}).`);
        });
        return () => { live = false; void task?.destroy(); };
    }, [url]);

    // the reader's width decides the pages' size
    useLayoutEffect(() => {
        const el = scroller.current;
        if (!el) return;
        const ro = new ResizeObserver(() => setWidth(el.clientWidth));
        ro.observe(el);
        setWidth(el.clientWidth);
        return () => ro.disconnect();
    }, [pdf, full]);

    // back where you left off, once the pages have a size
    useLayoutEffect(() => {
        if (!pdf || !width || restore.current === null) return;
        jump(restore.current);
        restore.current = null;
    }, [pdf, width]);

    function pageAt(): number {
        const el = scroller.current;
        if (!el) return 1;
        const mid = el.scrollTop + el.clientHeight / 3;
        let n = 1;
        for (const p of el.querySelectorAll<HTMLElement>(".reader__pdf-page")) {
            if (p.offsetTop <= mid) n = Number(p.dataset.page);
            else break;
        }
        return n;
    }

    function jump(n: number) {
        const target = scroller.current?.querySelector<HTMLElement>(`[data-page="${n}"]`);
        if (target && scroller.current) scroller.current.scrollTop = target.offsetTop - 8;
        setPage(n);
    }

    function changeZoom(z: number) {
        const keep = pageAt();
        restore.current = keep;
        setZoom(z);
        savePlace(docId, { chapter: 0, fraction: 0, page: keep, zoom: z });
    }
    useLayoutEffect(() => {
        if (restore.current !== null && pdf && width) { jump(restore.current); restore.current = null; }
    }, [zoom]);

    function scrolled() {
        clearTimeout(timer.current);
        timer.current = window.setTimeout(() => {
            const n = pageAt();
            setPage(n);
            savePlace(docId, { chapter: 0, fraction: 0, page: n, zoom });
        }, 150);
    }

    if (failed) return <p class="document-viewer document-viewer--unavailable">{failed}</p>;

    const pageWidth = Math.max(100, Math.round((width - 16) * ZOOMS[zoom]));
    return (
        <div class={`document-viewer reader reader--pdf${full ? " reader--full" : ""}`}>
            <ReaderBar full={full} onFull={toggleFull}>
                {pdf && (
                    <label class="reader__where">
                        Page
                        <input class="reader__page-input" type="number" min={1} max={pdf.numPages} value={page} inputMode="numeric"
                            onChange={e => {
                                const n = Math.min(pdf.numPages, Math.max(1, Number((e.currentTarget as HTMLInputElement).value) || 1));
                                jump(n);
                            }} />
                        of {pdf.numPages}
                    </label>
                )}
                <span class="reader__gap" />
                <button class="reader__button" type="button" onClick={() => changeZoom(zoom - 1)} disabled={!pdf || zoom === 0} aria-label="Zoom out">−</button>
                <button class="reader__button" type="button" onClick={() => changeZoom(2)} disabled={!pdf} aria-label="Fit width">{Math.round(ZOOMS[zoom] * 100)}%</button>
                <button class="reader__button" type="button" onClick={() => changeZoom(zoom + 1)} disabled={!pdf || zoom === ZOOMS.length - 1} aria-label="Zoom in">+</button>
            </ReaderBar>
            <div class="reader__pdf" ref={scroller} onScroll={scrolled} tabIndex={0}>
                {!pdf && <p class="document-viewer--loading">Opening the PDF…{progress > 0 && ` ${Math.round(progress * 100)}%`}</p>}
                {pdf && width > 0 && aspects.map((a, i) => (
                    <PdfPage key={i} pdf={pdf} n={i + 1} width={pageWidth} height={Math.round(pageWidth * a)} root={scroller.current} />
                ))}
            </div>
        </div>
    );
}

// One page: drawn when it comes near the screen, let go when it's far away,
// so a 500-page book doesn't hold 500 canvases.
function PdfPage({ pdf, n, width, height, root }: { pdf: PdfJs.PDFDocumentProxy, n: number, width: number, height: number, root: Element | null }) {
    const box = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const [near, setNear] = useState(false);

    useEffect(() => {
        const el = box.current;
        if (!el) return;
        const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: "150% 0px" });
        io.observe(el);
        return () => io.disconnect();
    }, [root]);

    useEffect(() => {
        const c = canvas.current;
        if (!c) return;
        if (!near) { c.width = c.height = 0; return; }
        let task: PdfJs.RenderTask | null = null;
        let live = true;
        pdf.getPage(n).then(p => {
            if (!live) return;
            const base = p.getViewport({ scale: 1 });
            let scale = (width / base.width) * (window.devicePixelRatio || 1);
            const pixels = base.width * base.height * scale * scale;
            if (pixels > MAX_PIXELS) scale *= Math.sqrt(MAX_PIXELS / pixels);
            const viewport = p.getViewport({ scale });
            c.width = Math.floor(viewport.width);
            c.height = Math.floor(viewport.height);
            task = p.render({ canvas: c, viewport });
            task.promise.catch(() => { /* cancelled by scrolling on */ });
        });
        return () => { live = false; task?.cancel(); };
    }, [near, width, pdf, n]);

    return (
        <div class="reader__pdf-page" data-page={n} ref={box} style={{ width: `${width}px`, height: `${height}px` }}>
            <canvas class="reader__pdf-canvas" ref={canvas} aria-label={`Page ${n}`} />
        </div>
    );
}
