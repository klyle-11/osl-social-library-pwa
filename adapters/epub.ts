import { Zip } from "./zip";

// An EPUB is a zip of web pages: container.xml points at the package (OPF), whose
// spine is the reading order. Each chapter is shown as its own page, with every
// image, stylesheet and font it uses swapped for a blob: URL made from the zip.
// Scripts are stripped (and the reader's frame doesn't run them anyway).

export interface TocEntry { label: string, href: string, depth: number }

interface ManifestItem { href: string, type: string, properties: string }

const XHTML = "application/xhtml+xml";
// the only "encryption" an EPUB may carry and still be readable: obfuscated fonts
const FONT_OBFUSCATION = /idpf\.org\/2008\/embedding|ns\.adobe\.com\/pdf\/enc#RC/;

export class Epub {
    title = "";
    author = "";
    spine: string[] = [];      // paths in the zip, in reading order
    toc: TocEntry[] = [];
    private coverPath: string | null = null;
    private readonly urls = new Map<string, Promise<string>>();
    private readonly types = new Map<string, string>();

    private constructor(private readonly zip: Zip) {}

    static async open(bytes: Uint8Array): Promise<Epub> {
        const zip = new Zip(bytes);
        const book = new Epub(zip);
        await book.load();
        return book;
    }

    private async load() {
        if (this.zip.has("META-INF/encryption.xml")) {
            const enc = xml(await this.zip.text("META-INF/encryption.xml"));
            const methods = [...enc.getElementsByTagNameNS("*", "EncryptionMethod")].map(m => m.getAttribute("Algorithm") ?? "");
            if (methods.some(m => !FONT_OBFUSCATION.test(m))) {
                throw new Error("This EPUB is locked with DRM, so it can't be read here. A DRM-free copy will work.");
            }
        }
        if (!this.zip.has("META-INF/container.xml")) throw new Error("This doesn't look like an EPUB (no container.xml).");
        const container = xml(await this.zip.text("META-INF/container.xml"));
        const opfPath = container.getElementsByTagNameNS("*", "rootfile")[0]?.getAttribute("full-path");
        if (!opfPath) throw new Error("This EPUB is damaged (no package file).");
        const opf = xml(await this.zip.text(opfPath));

        this.title = clean(opf.getElementsByTagNameNS("*", "title")[0]?.textContent);
        this.author = clean(opf.getElementsByTagNameNS("*", "creator")[0]?.textContent);
        const items = new Map<string, ManifestItem>();
        for (const el of opf.getElementsByTagNameNS("*", "item")) {
            const id = el.getAttribute("id"), href = el.getAttribute("href");
            if (!id || !href) continue;
            const item = { href: resolve(opfPath, href), type: el.getAttribute("media-type") ?? "", properties: el.getAttribute("properties") ?? "" };
            items.set(id, item);
            this.types.set(item.href, item.type);
        }
        // the cover: EPUB 3 marks it, EPUB 2 names it in a <meta>, and failing both it's usually called "cover"
        const cover = [...items.values()].find(i => i.properties.split(/\s+/).includes("cover-image"))
            ?? items.get([...opf.getElementsByTagNameNS("*", "meta")].find(m => m.getAttribute("name") === "cover")?.getAttribute("content") ?? "")
            ?? [...items.entries()].find(([id, i]) => i.type.startsWith("image/") && /cover/i.test(id + i.href))?.[1];
        if (cover && cover.type.startsWith("image/") && this.zip.has(cover.href)) this.coverPath = cover.href;
        const spineEl = opf.getElementsByTagNameNS("*", "spine")[0];
        for (const ref of opf.getElementsByTagNameNS("*", "itemref")) {
            if (ref.getAttribute("linear") === "no") continue;
            const item = items.get(ref.getAttribute("idref") ?? "");
            if (item && this.zip.has(item.href)) this.spine.push(item.href);
        }
        if (!this.spine.length) throw new Error("This EPUB has no chapters to show.");

        // contents: the EPUB 3 nav document, else the EPUB 2 NCX
        const nav = [...items.values()].find(i => i.properties.split(/\s+/).includes("nav"));
        const ncx = items.get(spineEl?.getAttribute("toc") ?? "") ?? [...items.values()].find(i => i.type === "application/x-dtbncx+xml");
        try {
            if (nav && this.zip.has(nav.href)) this.toc = this.navToc(nav.href, xml(await this.zip.text(nav.href), nav.type || XHTML));
            if (!this.toc.length && ncx && this.zip.has(ncx.href)) this.toc = this.ncxToc(ncx.href, xml(await this.zip.text(ncx.href)));
        } catch {
            this.toc = [];   // a broken table of contents shouldn't stop the book opening
        }
    }

    private navToc(base: string, doc: Document): TocEntry[] {
        const navs = [...doc.getElementsByTagNameNS("*", "nav")];
        const toc = navs.find(n => (n.getAttributeNS("http://www.idpf.org/2007/ops", "type") ?? n.getAttribute("epub:type")) === "toc") ?? navs[0];
        if (!toc) return [];
        const out: TocEntry[] = [];
        const walk = (list: Element, depth: number) => {
            for (const li of list.children) {
                if (li.localName !== "li") continue;
                const a = [...li.children].find(c => c.localName === "a" || c.localName === "span");
                const href = a?.getAttribute("href");
                if (a && href) out.push({ label: clean(a.textContent), href: resolve(base, href), depth });
                const sub = [...li.children].find(c => c.localName === "ol" || c.localName === "ul");
                if (sub) walk(sub, depth + 1);
            }
        };
        const top = [...toc.children].find(c => c.localName === "ol" || c.localName === "ul");
        if (top) walk(top, 0);
        return out;
    }

    private ncxToc(base: string, doc: Document): TocEntry[] {
        const out: TocEntry[] = [];
        const walk = (parent: Element, depth: number) => {
            for (const point of parent.children) {
                if (point.localName !== "navPoint") continue;
                const label = point.getElementsByTagNameNS("*", "text")[0]?.textContent;
                const src = point.getElementsByTagNameNS("*", "content")[0]?.getAttribute("src");
                if (src) out.push({ label: clean(label), href: resolve(base, src), depth });
                walk(point, depth + 1);
            }
        };
        const map = doc.getElementsByTagNameNS("*", "navMap")[0];
        if (map) walk(map, 0);
        return out;
    }

    async coverImage(): Promise<Blob | null> {
        if (!this.coverPath) return null;
        return new Blob([await this.zip.read(this.coverPath) as BlobPart], { type: this.types.get(this.coverPath) || guessType(this.coverPath) });
    }

    // the spine position of "chapter.xhtml#section", or -1
    indexOf(href: string): number {
        return this.spine.indexOf(href.split("#")[0]);
    }

    // a blob: URL of chapter i, ready for the reader's frame
    chapter(i: number): Promise<string> {
        return this.url(this.spine[i]);
    }

    private url(path: string): Promise<string> {
        let p = this.urls.get(path);
        if (!p) {
            p = this.build(path);
            this.urls.set(path, p);
        }
        return p;
    }

    private async build(path: string): Promise<string> {
        const type = this.types.get(path) || guessType(path);
        if (type === XHTML || type === "text/html") return this.page(path, type);
        if (type === "text/css") return URL.createObjectURL(new Blob([await this.css(path, await this.zip.text(path))], { type }));
        return URL.createObjectURL(new Blob([await this.zip.read(path) as BlobPart], { type }));
    }

    // a resource the book refers to, or "" if it isn't in the zip
    private async ref(from: string, href: string): Promise<string> {
        if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#")) return href;
        const [file, frag] = href.split("#");
        const path = resolve(from, file);
        if (!this.zip.has(path)) return "";
        return (await this.url(path)) + (frag ? "#" + frag : "");
    }

    private async css(path: string, text: string): Promise<string> {
        const found = [...text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g)];
        const swaps = await Promise.all(found.map(m => this.ref(path, (m[2] ?? m[4]).trim())));
        let i = 0;
        return text.replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)|@import\s+(['"])([^'"]+)\3/g, m => {
            const to = swaps[i++];
            return m.startsWith("@import") ? `@import "${to}"` : `url("${to}")`;
        });
    }

    private async page(path: string, type: string): Promise<string> {
        const source = await this.zip.text(path);
        let doc = new DOMParser().parseFromString(source, type === "text/html" ? "text/html" : XHTML);
        let asXml = type !== "text/html";
        if (asXml && doc.getElementsByTagName("parsererror").length) {
            doc = new DOMParser().parseFromString(source, "text/html");   // not well-formed: read it as HTML
            asXml = false;
        }
        for (const el of [...doc.querySelectorAll("script, base, meta[http-equiv]")]) el.remove();
        const jobs: Promise<void>[] = [];
        for (const el of doc.querySelectorAll("*")) {
            for (const attr of [...el.attributes]) {
                if (/^on/i.test(attr.name)) el.removeAttribute(attr.name);
            }
            const name = el.localName;
            const swap = (attr: string, ns?: string) => {
                const v = ns ? el.getAttributeNS(ns, attr) : el.getAttribute(attr);
                if (!v) return;
                jobs.push(this.ref(path, v).then(to => { ns ? el.setAttributeNS(ns, attr, to) : el.setAttribute(attr, to); }));
            };
            if (name === "img" || name === "source" || name === "audio" || name === "video" || name === "track") swap("src");
            if (name === "video") swap("poster");
            if (name === "link" && /stylesheet/i.test(el.getAttribute("rel") ?? "")) swap("href");
            if (name === "image" || name === "use") { swap("href"); swap("href", "http://www.w3.org/1999/xlink"); }
            if (name === "style" && el.textContent) jobs.push(this.css(path, el.textContent).then(t => { el.textContent = t; }));
            const style = el.getAttribute("style");
            if (style && style.includes("url(")) jobs.push(this.css(path, style).then(t => el.setAttribute("style", t)));
            // in-book links keep their place in the book; the reader follows them
            if (name === "a") {
                const href = el.getAttribute("href");
                if (href && !/^[a-z][a-z0-9+.-]*:/i.test(href)) el.setAttribute("data-osl-href", href.startsWith("#") ? path + href : resolve(path, href));
            }
        }
        await Promise.all(jobs);
        const out = asXml
            ? new XMLSerializer().serializeToString(doc)
            : "<!doctype html>\n" + doc.documentElement.outerHTML;
        return URL.createObjectURL(new Blob([out], { type: asXml ? XHTML : "text/html" }));
    }

    close() {
        for (const p of this.urls.values()) p.then(u => URL.revokeObjectURL(u), () => {});
        this.urls.clear();
    }
}

function xml(text: string, type = "application/xml"): Document {
    return new DOMParser().parseFromString(text, type as DOMParserSupportedType);
}

function clean(s: string | null | undefined): string {
    return (s ?? "").replace(/\s+/g, " ").trim();
}

// a path inside the zip, from the file that refers to it
export function resolve(from: string, href: string): string {
    const [file, frag] = href.split("#");
    const u = new URL(file || from.split("#")[0], "https://book.invalid/" + from);
    const path = decodeURIComponent(u.pathname.slice(1));
    return frag !== undefined ? `${path}#${frag}` : path;
}

function guessType(path: string): string {
    const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
    return ({
        xhtml: XHTML, html: "text/html", htm: "text/html", css: "text/css", svg: "image/svg+xml",
        jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", gif: "image/gif", webp: "image/webp",
        otf: "font/otf", ttf: "font/ttf", woff: "font/woff", woff2: "font/woff2", mp3: "audio/mpeg", mp4: "video/mp4"
    } as Record<string, string>)[ext] ?? "application/octet-stream";
}
