import type { LibraryDocument } from "../core/types";

// Who someone is, for the screen: everything a view knows about people (core/views.ts).
export type People = { names: Record<string, string>, devices: Record<string, string>, accounts: Record<string, string> };

// An account's name as it is; a guest's with "(Guest)", so nobody passes for someone with
// an account. A device signed in to an account is that account. `me` is this device.
export function displayName(user: string, p: People, me: string): string {
    const person = p.devices[user] ?? user;
    const mine = person === (p.devices[me] ?? me);
    const account = p.accounts[person];
    if (account) return mine ? `${account} (you)` : account;
    if (user === "steward" || user === "folder") return "The library";
    const name = p.names[user];
    if (mine) return name ? `${name} (you)` : "You";
    if (name) return `${name} (Guest)`;
    if (person.startsWith("a-")) return "Someone";
    return `Guest ${user.replace(/^d-/, "").slice(0, 4)}`;
}

export function when(timestamp: string): string {
    const seconds = (Date.now() - Date.parse(timestamp)) / 1000;
    if (seconds < 60) return "just now";
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return new Date(timestamp).toLocaleDateString();
}

export const MEDIUMS: [string, string][] = [
    ["", "Unspecified"], ["photo", "Photo"], ["letter", "Letter"], ["essay", "Essay"], ["book", "Book"],
    ["poem", "Poem"], ["audio", "Audio"], ["shortFilm", "Short film"], ["film", "Film"], ["other", "Other"]
];

export function mediumLabel(type: string): string {
    return MEDIUMS.find(([v]) => v === type)?.[1] ?? type;
}

// where a document's file can be fetched from, if it has one
export function fileUrl(doc: LibraryDocument): string | null {
    if (doc.url && doc.fileType !== "link") return doc.url;
    if (doc.hash) return `media/${doc.hash}`;
    return null;
}

// "Ama, Rosa (Guest) and 2 guests": people with names first, everyone else counted
export function listPeople(users: string[], p: People): string {
    const nameOf = (u: string) => p.accounts[p.devices[u] ?? u] ?? (p.names[u] ? `${p.names[u]} (Guest)` : null);
    const named = [...new Set(users.map(nameOf).filter((n): n is string => !!n))];
    users = [...new Set(users.map(u => p.devices[u] ?? u))];
    const guests = users.length - named.length;
    const parts = [...named];
    if (guests === 1) parts.push(named.length ? "a guest" : "A guest");
    else if (guests > 1) parts.push(`${guests} guests`);
    if (parts.length <= 1) return parts[0] ?? "";
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

// what's attached, in words: for the gallery's format filter and its cards
export const FORMATS: [string, string][] = [
    ["pdf", "PDF"], ["epub", "EPUB"], ["image", "Image"], ["audio", "Audio"], ["video", "Video"],
    ["text", "Text file"], ["link", "Link"], ["file", "Other file"], ["none", "Description only"]
];

export function formatOf(fileType: string): string {
    return fileType === "text" ? "none" : fileKind(fileType);   // "text" alone means nothing is attached
}

export function formatLabel(fileType: string): string {
    const f = formatOf(fileType);
    return FORMATS.find(([k]) => k === f)?.[1] ?? "";
}

export function fileKind(fileType: string): "image" | "audio" | "video" | "text" | "pdf" | "epub" | "link" | "file" {
    if (fileType.startsWith("image/")) return "image";
    if (fileType.startsWith("audio/")) return "audio";
    if (fileType.startsWith("video/")) return "video";
    if (fileType.startsWith("text")) return "text";
    if (fileType === "application/pdf") return "pdf";
    if (fileType === "application/epub+zip") return "epub";
    if (fileType === "link") return "link";
    return "file";
}
