import type { LibraryDocument } from "../core/types";

export function displayName(user: string, names: Record<string, string>, me: string): string {
    if (user === me) return names[user] ? `${names[user]} (you)` : "You";
    if (names[user]) return names[user];
    if (user === "steward") return "The library";
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

// "Ama, Rosa and 2 guests": named people first, guests counted
export function listPeople(users: string[], names: Record<string, string>): string {
    const named = users.filter(u => names[u]).map(u => names[u]);
    const guests = users.length - named.length;
    const parts = [...named];
    if (guests === 1) parts.push(named.length ? "a guest" : "A guest");
    else if (guests > 1) parts.push(`${guests} guests`);
    if (parts.length <= 1) return parts[0] ?? "";
    return `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}`;
}

export function fileKind(fileType: string): "image" | "audio" | "video" | "text" | "pdf" | "link" | "file" {
    if (fileType.startsWith("image/")) return "image";
    if (fileType.startsWith("audio/")) return "audio";
    if (fileType.startsWith("video/")) return "video";
    if (fileType.startsWith("text")) return "text";
    if (fileType === "application/pdf") return "pdf";
    if (fileType === "link") return "link";
    return "file";
}
