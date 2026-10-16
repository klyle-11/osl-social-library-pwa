import type * as PdfJs from "pdfjs-dist";

declare const OSL_PDFJS: string;   // "vendor/pdfjs-<version>/", set by the build

export type { PdfJs };

// pdf.js is large (about 1.7 MB with its worker), so it's fetched the first time
// it's needed (a PDF opened or added), not with the app. Carried PDFs carry it too (sync.ts).
let library: Promise<typeof PdfJs> | null = null;
export function pdfjs(): Promise<typeof PdfJs> {
    if (!library) {
        const base = pdfjsBase();
        library = (import(/* esbuild: leave this to the browser */ base + "pdf.min.mjs") as Promise<typeof PdfJs>).then(lib => {
            lib.GlobalWorkerOptions.workerSrc = base + "pdf.worker.min.mjs";
            return lib;
        });
        library.catch(() => { library = null; });
    }
    return library;
}

export function pdfjsBase(): string {
    return new URL(OSL_PDFJS, document.baseURI).href;
}

// where pdf.js finds its fonts, character maps and image decoders
export function pdfjsAssets() {
    const base = pdfjsBase();
    return { cMapUrl: base + "cmaps/", cMapPacked: true, standardFontDataUrl: base + "standard_fonts/", wasmUrl: base + "wasm/", iccUrl: base + "iccs/" };
}
