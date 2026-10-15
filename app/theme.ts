import { effect, signal } from "@preact/signals";

// The colour themes (styles.css sets each one's colours under :root[data-theme]).
// A choice belongs to this device: the big screen can be dark while phones are paper.
// index.html applies the saved choice before the first paint, so nothing flashes.
export type ThemeId = "paper" | "light" | "dark" | "black" | "maroon";

// `bg`, `ink` and `accent` draw the swatch on the picker and colour the phone's
// browser bar; they repeat the values in styles.css.
export const THEMES: { id: ThemeId, name: string, note: string, bg: string, ink: string, accent: string, dots: string[] }[] = [
    { id: "paper", name: "Paper", note: "White, the default", bg: "#fffffc", ink: "#282828", accent: "#d6000c", dots: ["#d6000c", "#0064e4", "#008800"] },
    { id: "light", name: "Selenized light", note: "Warm, easy on the eyes", bg: "#fbf3db", ink: "#3a4d53", accent: "#d2212d", dots: ["#d2212d", "#006dce", "#327d00"] },
    { id: "dark", name: "Selenized dark", note: "For a dim room", bg: "#103c48", ink: "#cad8d9", accent: "#dbb32d", dots: ["#dbb32d", "#58a3ff", "#75b938"] },
    { id: "black", name: "Selenized black", note: "For the big screen at night", bg: "#181818", ink: "#dedede", accent: "#dbb32d", dots: ["#dbb32d", "#4f9cfe", "#70b433"] },
    { id: "maroon", name: "Maroon", note: "The workshop's first colours", bg: "#1d163e", ink: "#fffffc", accent: "#f4c877", dots: ["#f4c877", "#8b2338", "#7fe0a8"] }
];

const KEY = "osl-theme";   // also read by the script in index.html

function saved(): ThemeId {
    try {
        const v = localStorage.getItem(KEY);
        return THEMES.some(t => t.id === v) ? v as ThemeId : "paper";
    } catch {
        return "paper";   // storage blocked: the default, every time
    }
}

export const theme = signal<ThemeId>(saved());

export function startTheme() {
    effect(() => {
        const t = THEMES.find(x => x.id === theme.value) ?? THEMES[0];
        if (t.id === "paper") delete document.documentElement.dataset.theme;
        else document.documentElement.dataset.theme = t.id;
        document.querySelector('meta[name="theme-color"]')?.setAttribute("content", t.bg);
        try { localStorage.setItem(KEY, t.id); } catch { /* not kept: fine for this visit */ }
    });
}
