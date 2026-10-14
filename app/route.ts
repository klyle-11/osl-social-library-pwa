import { signal } from "@preact/signals";

// Hash routes, so the back button works and any static host can serve it.
export type Route =
    | { view: "gallery" } | { view: "activity" } | { view: "collections" } | { view: "add" } | { view: "you" }
    | { view: "sync" } | { view: "present" }
    | { view: "document", id: string } | { view: "collection", id: string };

export function parseRoute(hash: string): Route {
    const [, view = "", id = ""] = hash.replace(/^#/, "").split("/");
    const arg = decodeURIComponent(id);
    switch (view) {
        case "activity": case "collections": case "add": case "you": case "sync": case "present": return { view };
        case "document": return arg ? { view, id: arg } : { view: "gallery" };
        case "collection": return arg ? { view, id: arg } : { view: "collections" };
        default: return { view: "gallery" };
    }
}

export function href(route: Route): string {
    return "id" in route ? `#/${route.view}/${encodeURIComponent(route.id)}` : `#/${route.view}`;
}

export const route = signal<Route>(parseRoute(location.hash));

addEventListener("hashchange", () => {
    route.value = parseRoute(location.hash);
    scrollTo(0, 0);
});
