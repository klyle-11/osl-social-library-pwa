import { useEffect, useLayoutEffect, useRef } from "preact/hooks";
import type { RefObject } from "preact";

// Two fingers on a document zoom the document, not the page. The page itself
// never zooms on a phone (index.html, styles.css, noPageZoom below), so the header,
// the reader's toolbar and the notes stay on the screen.

export interface PinchHandlers {
    // scale since the fingers came down, around the point between them when they did (client pixels)
    move(scale: number, x: number, y: number): void;
    end(scale: number, x: number, y: number): void;
}

// Listens on an element, or on a frame's document (a book's chapter). A trackpad's pinch
// counts too: browsers report it as a wheel turned with ctrl held. Returns the way to stop.
export function onPinch(target: HTMLElement | Document, h: PinchHandlers): () => void {
    let start = 1, x = 0, y = 0, scale = 1, touching = false, wheeling = false, frame = 0, timer = 0;
    const span = (t: TouchList) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
    // at most once a frame: a finger reports far more often than the screen redraws
    const later = () => {
        if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (touching || wheeling) h.move(scale, x, y); });
    };
    const finish = () => { cancelAnimationFrame(frame); frame = 0; h.end(scale, x, y); };

    const down = (e: Event) => {
        const t = (e as TouchEvent).touches;
        if (t.length !== 2) return;
        start = span(t);
        x = (t[0].clientX + t[1].clientX) / 2;
        y = (t[0].clientY + t[1].clientY) / 2;
        scale = 1;
        touching = true;
    };
    const moved = (e: Event) => {
        const t = (e as TouchEvent).touches;
        if (!touching || t.length !== 2) return;
        if (e.cancelable) e.preventDefault();   // two fingers: neither scroll nor zoom the page
        scale = span(t) / start;
        later();
    };
    const up = (e: Event) => {
        if (!touching || (e as TouchEvent).touches.length >= 2) return;
        touching = false;
        finish();
    };
    const wheel = (e: Event) => {
        const w = e as WheelEvent;
        if (!w.ctrlKey || touching) return;
        e.preventDefault();
        if (!wheeling) { wheeling = true; scale = 1; x = w.clientX; y = w.clientY; }
        scale *= Math.exp(-w.deltaY / 100);
        later();
        clearTimeout(timer);
        timer = window.setTimeout(() => { wheeling = false; finish(); }, 200);
    };

    target.addEventListener("touchstart", down, { passive: true });
    target.addEventListener("touchmove", moved, { passive: false });
    target.addEventListener("touchend", up);
    target.addEventListener("touchcancel", up);
    target.addEventListener("wheel", wheel, { passive: false });
    return () => {
        target.removeEventListener("touchstart", down);
        target.removeEventListener("touchmove", moved);
        target.removeEventListener("touchend", up);
        target.removeEventListener("touchcancel", up);
        target.removeEventListener("wheel", wheel);
        cancelAnimationFrame(frame);
        clearTimeout(timer);
    };
}

// iPhones and iPads ignore user-scalable=no (index.html) and touch-action: their own
// gesture events are how to say no. A computer's browser zoom is left alone.
export function noPageZoom(doc: Document = document) {
    if (!navigator.maxTouchPoints) return;
    const no = (e: Event) => e.preventDefault();
    doc.addEventListener("gesturestart", no);
    doc.addEventListener("gesturechange", no);
}

export interface PinchZoom {
    scroller: RefObject<HTMLElement>;   // the box that scrolls, and takes the fingers
    content: RefObject<HTMLElement>;    // what grows: stretched while the fingers move
    zoom: number;
    min: number;
    max: number;
    set(zoom: number): void;            // the fingers lifted: lay the content out at this zoom
    under(x: number, y: number): HTMLElement | null;   // what's under the fingers (a page, the photo)
}

// Pinch zoom for a box of things drawn at a size (PDF pages, a photo). While the fingers
// move the content is only stretched, which costs nothing; when they lift, the new zoom is
// laid out and the box scrolled so the point that was under them is under them still.
export function usePinchZoom(o: PinchZoom) {
    const now = useRef(o);
    now.current = o;
    const anchor = useRef<{ el: HTMLElement, fx: number, fy: number, x: number, y: number } | null>(null);

    useEffect(() => {
        const box = o.scroller.current;
        if (!box) return;
        let grip: typeof anchor.current = null;
        let gripped = false;
        const fit = (s: number) => { const { zoom, min, max } = now.current; return Math.min(max, Math.max(min, zoom * s)) / zoom; };
        return onPinch(box, {
            move(s, x, y) {
                const c = now.current.content.current;
                if (!c) return;
                if (!gripped) {
                    gripped = true;
                    const el = now.current.under(x, y);
                    if (el) { const r = el.getBoundingClientRect(); grip = { el, fx: (x - r.left) / r.width, fy: (y - r.top) / r.height, x, y }; }
                    const r = c.getBoundingClientRect();
                    c.style.transformOrigin = `${x - r.left}px ${y - r.top}px`;
                }
                c.style.transform = `scale(${fit(s)})`;
            },
            end(s) {
                const { zoom, set, content } = now.current;
                const next = zoom * fit(s);
                anchor.current = grip;
                grip = null;
                gripped = false;
                if (Math.abs(next - zoom) < 0.01) {
                    anchor.current = null;
                    content.current?.style.removeProperty("transform");
                    return;
                }
                set(next);
            },
        });
    }, []);

    // the new size is laid out: drop the stretch and put the point back under the fingers, before the screen redraws
    useLayoutEffect(() => {
        const c = o.content.current, box = o.scroller.current, a = anchor.current;
        anchor.current = null;
        c?.style.removeProperty("transform");
        c?.style.removeProperty("transform-origin");
        if (!a || !box) return;
        const r = a.el.getBoundingClientRect();
        box.scrollLeft += r.left + a.fx * r.width - a.x;
        box.scrollTop += r.top + a.fy * r.height - a.y;
    }, [o.zoom]);
}
