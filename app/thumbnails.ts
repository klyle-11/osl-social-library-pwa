import { Epub } from "../adapters/epub";
import { fileTypeOf } from "../adapters/http-transport";
import { pdfjs, pdfjsAssets, type PdfJs } from "./pdfjs";

// Small pictures for the gallery, made on the device that has the file: a PDF's
// first page, a book's cover, a frame of a film, a scan made small. The node only
// stores them; it has nothing to draw a PDF with.

const SIDE = 480;   // the longest side, in pixels: sharp on a phone's gallery card

export async function thumbnailOf(file: Blob, type = file instanceof File ? fileTypeOf(file) : file.type): Promise<Blob | null> {
    try {
        if (type === "application/pdf") return await pdfThumbnail({ data: new Uint8Array(await file.arrayBuffer()) });
        if (type === "application/epub+zip") {
            const book = await Epub.open(new Uint8Array(await file.arrayBuffer()));
            try { const cover = await book.coverImage(); return cover && await imageThumbnail(cover); } finally { book.close(); }
        }
        if (type.startsWith("video/")) return await videoThumbnail(URL.createObjectURL(file), true);
        if (type.startsWith("image/") && type !== "image/svg+xml") return await imageThumbnail(file);
    } catch {
        // no thumbnail is fine: the gallery shows the kind of file instead
    }
    return null;
}

export async function pdfThumbnail(source: { data: Uint8Array } | { pdf: PdfJs.PDFDocumentProxy }): Promise<Blob | null> {
    const lib = await pdfjs();
    const task = "pdf" in source ? null : lib.getDocument({ data: source.data, ...pdfjsAssets() });
    const doc = task ? await task.promise : (source as { pdf: PdfJs.PDFDocumentProxy }).pdf;
    try {
        const page = await doc.getPage(1);
        const base = page.getViewport({ scale: 1 });
        const viewport = page.getViewport({ scale: SIDE / Math.max(base.width, base.height) });
        const canvas = document.createElement("canvas");
        canvas.width = Math.floor(viewport.width);
        canvas.height = Math.floor(viewport.height);
        await page.render({ canvas, viewport }).promise;
        return await jpeg(canvas);
    } finally {
        void task?.destroy();
    }
}

export async function imageThumbnail(image: Blob): Promise<Blob | null> {
    const url = URL.createObjectURL(image);
    try {
        const img = new Image();
        img.src = url;
        await img.decode();
        return await jpeg(draw(img, img.naturalWidth, img.naturalHeight));
    } finally {
        URL.revokeObjectURL(url);
    }
}

// a frame a little way in: the first one is often black
export async function videoThumbnail(src: string, revoke = false): Promise<Blob | null> {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.preload = "auto";
    video.src = src;
    try {
        await event(video, "loadeddata");
        video.currentTime = Math.min(1, (video.duration || 0) / 10);
        await event(video, "seeked");
        return await jpeg(draw(video, video.videoWidth, video.videoHeight));
    } finally {
        video.removeAttribute("src");
        video.load();
        if (revoke) URL.revokeObjectURL(src);
    }
}

function draw(source: CanvasImageSource, w: number, h: number): HTMLCanvasElement {
    if (!w || !h) throw new Error("nothing to draw");
    const scale = Math.min(1, SIDE / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    const ctx = canvas.getContext("2d")!;
    ctx.fillStyle = "#fff";   // transparent covers would turn black as JPEG
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    return canvas;
}

function jpeg(canvas: HTMLCanvasElement): Promise<Blob | null> {
    return new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.8));
}

function event(el: HTMLElement, name: string, ms = 10_000): Promise<void> {
    return new Promise((ok, fail) => {
        const t = setTimeout(() => fail(new Error("timeout")), ms);
        el.addEventListener(name, () => { clearTimeout(t); ok(); }, { once: true });
        el.addEventListener("error", () => { clearTimeout(t); fail(new Error("can't read it")); }, { once: true });
    });
}
