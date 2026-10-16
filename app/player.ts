import { computed, signal } from "@preact/signals";
import type { LibraryDocument, OpId } from "../core/types";
import { fileUrl } from "./format";
import { MAIN, libraryId } from "./library";

// One player for the whole app: a single <audio> element that outlives every page, so a
// recording keeps playing while people browse. The queue is this device's own, kept
// across visits; where in a recording it stopped is not.

// each library has its own queue: its recordings are its own
const KEY = libraryId === MAIN ? "osl-queue" : `osl-queue:${libraryId}`;

export const queue = signal<OpId[]>(load());
export const current = signal(-1);          // index into queue; -1 when nothing is loaded
export const playing = signal(false);
export const position = signal(0);          // seconds
export const duration = signal(0);          // seconds; 0 until known
export const failed = signal<string | null>(null);

export const nowPlaying = computed(() => queue.value[current.value] ?? null);

const STEP = 15;

let audio: HTMLAudioElement | null = null;
let lookup: (id: OpId) => LibraryDocument | undefined = () => undefined;

// The app tells the player where documents are (the views change as ops arrive).
export function startPlayer(find: (id: OpId) => LibraryDocument | undefined) {
    lookup = find;
    const saved = Number(read(KEY + "-at"));
    if (queue.value.length && Number.isInteger(saved) && saved >= 0 && saved < queue.value.length) current.value = saved;
}

function element(): HTMLAudioElement {
    if (audio) return audio;
    audio = new Audio();
    audio.preload = "metadata";
    audio.addEventListener("timeupdate", () => { position.value = audio!.currentTime; });
    audio.addEventListener("durationchange", () => { duration.value = Number.isFinite(audio!.duration) ? audio!.duration : 0; });
    audio.addEventListener("play", () => { playing.value = true; failed.value = null; });
    audio.addEventListener("pause", () => { playing.value = false; });
    audio.addEventListener("ended", () => { playing.value = false; if (!next()) position.value = 0; });
    audio.addEventListener("error", () => {
        playing.value = false;
        failed.value = navigator.onLine ? "This recording can't be played here." : "Not available offline. Keep it next time you're connected.";
    });
    mediaSession();
    return audio;
}

// The lock screen and headphone buttons on phones.
function mediaSession() {
    if (!("mediaSession" in navigator)) return;
    const ms = navigator.mediaSession;
    const set = (action: MediaSessionAction, fn: () => void) => { try { ms.setActionHandler(action, fn); } catch { /* not on this browser */ } };
    set("play", () => void resume());
    set("pause", pause);
    set("seekbackward", () => skip(-STEP));
    set("seekforward", () => skip(STEP));
    set("previoustrack", previous);
    set("nexttrack", () => { next(); });
}

function load(): OpId[] {
    try {
        const v: unknown = JSON.parse(read(KEY) ?? "[]");
        return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 200) : [];
    } catch {
        return [];
    }
}

function read(key: string): string | null {
    try { return localStorage.getItem(key); } catch { return null; }
}

function save() {
    try {
        localStorage.setItem(KEY, JSON.stringify(queue.value));
        localStorage.setItem(KEY + "-at", String(current.value));
    } catch { /* kept for this visit only */ }
}

// Load queue item `index` and play it.
async function start(index: number) {
    const id = queue.value[index];
    const doc = id ? lookup(id) : undefined;
    const url = doc && fileUrl(doc);
    current.value = index;
    save();
    if (!url) { failed.value = "This item has no recording."; return; }
    const el = element();
    el.src = new URL(url, document.baseURI).href;
    position.value = 0;
    duration.value = 0;
    failed.value = null;
    if ("mediaSession" in navigator && "MediaMetadata" in window) {
        navigator.mediaSession.metadata = new MediaMetadata({ title: doc.properties.title, artist: doc.properties.author ?? "", album: "OSL" });
    }
    try { await el.play(); } catch { playing.value = false; }   // a browser may want a tap first
}

// Play this now: it goes to the front of what's left, and the queue carries on after it.
export function play(id: OpId) {
    const at = queue.value.indexOf(id);
    if (at >= 0) return start(at);
    const insert = current.value >= 0 ? current.value + 1 : queue.value.length;
    queue.value = [...queue.value.slice(0, insert), id, ...queue.value.slice(insert)];
    return start(insert);
}

export function enqueue(id: OpId) {
    if (queue.value.includes(id)) return;
    queue.value = [...queue.value, id];
    save();
}

export function inQueue(id: OpId): boolean {
    return queue.value.includes(id);
}

export async function resume() {
    if (current.value < 0) return queue.value.length ? start(0) : undefined;
    const el = element();
    if (!el.src) return start(current.value);
    try { await el.play(); } catch { playing.value = false; }
}

export function pause() {
    audio?.pause();
}

export function toggle() {
    if (playing.value) pause();
    else void resume();
}

export function skip(seconds: number) {
    if (!audio) return;
    const end = Number.isFinite(audio.duration) ? audio.duration : Infinity;
    audio.currentTime = Math.max(0, Math.min(end, audio.currentTime + seconds));
}

export function seekTo(seconds: number) {
    if (audio && Number.isFinite(seconds)) audio.currentTime = seconds;
}

export function next(): boolean {
    if (current.value + 1 >= queue.value.length) return false;
    void start(current.value + 1);
    return true;
}

export function previous() {
    // as on any player: back to the start, or to the one before if it only just began
    if (audio && audio.currentTime > 3) { audio.currentTime = 0; return; }
    if (current.value > 0) void start(current.value - 1);
}

export function removeAt(index: number) {
    const ids = [...queue.value];
    ids.splice(index, 1);
    queue.value = ids;
    if (index === current.value) {
        pause();
        if (audio) audio.removeAttribute("src");
        current.value = ids.length ? Math.min(index, ids.length - 1) : -1;
        position.value = 0;
        duration.value = 0;
    } else if (index < current.value) {
        current.value -= 1;
    }
    save();
}

export function move(index: number, by: -1 | 1) {
    const to = index + by;
    if (to < 0 || to >= queue.value.length) return;
    const ids = [...queue.value];
    [ids[index], ids[to]] = [ids[to], ids[index]];
    queue.value = ids;
    if (current.value === index) current.value = to;
    else if (current.value === to) current.value = index;
    save();
}

export function clearQueue() {
    pause();
    if (audio) audio.removeAttribute("src");
    queue.value = [];
    current.value = -1;
    position.value = 0;
    duration.value = 0;
    save();
}

export function clock(seconds: number): string {
    if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
    const s = Math.floor(seconds % 60), m = Math.floor(seconds / 60) % 60, h = Math.floor(seconds / 3600);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

export const STEP_SECONDS = STEP;
