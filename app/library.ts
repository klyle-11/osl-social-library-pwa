// Which library this page is: `?library=<id>` in the address, or the one this device used
// last (main the first time). Each library has its own storage on the device, so moving
// to another is a reload, not a merge (docs/libraries-and-accounts.md).
const KEY = "osl-library";
export const MAIN = "main";
const ID = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/;

function pick(): string {
    const asked = new URLSearchParams(location.search).get("library");
    if (asked && ID.test(asked)) {
        try { localStorage.setItem(KEY, asked); } catch { /* only for this visit */ }
        return asked;
    }
    try {
        const last = localStorage.getItem(KEY);
        if (last && ID.test(last)) return last;
    } catch { /* storage blocked */ }
    return MAIN;
}

export const libraryId = pick();

// an API path for this library: "api/export" for the main one, "api/l/<id>/export" for another
export function apiPath(path: string, id = libraryId): string {
    return id === MAIN ? `api/${path}` : `api/l/${encodeURIComponent(id)}/${path}`;
}

// where this library's things are kept on the device
export function storageName(id = libraryId): string {
    return id === MAIN ? "osl" : `osl-lib-${id}`;
}

// a link that opens a library, for the join code and the switcher
export function libraryUrl(id: string, base = location.href): string {
    const u = new URL(base);
    u.hash = "";
    u.search = id === MAIN ? "?library=main" : `?library=${encodeURIComponent(id)}`;
    return u.href;
}

export function switchTo(id: string) {
    try { localStorage.setItem(KEY, id); } catch { /* the address carries it */ }
    location.href = libraryUrl(id);
}
