// A cursor is "<log id>.<position>": how far a device has read one node's log.
// Each node numbers its own log (the library, and every drop point), so a phone
// keeps one cursor per node and sends them all; each node picks out its own.
// A cursor from a log that no longer exists (a clean start) matches nothing, and
// that node is read from the beginning, which is safe because merging is idempotent.

export const MAX_CURSORS = 8;

// "abc.12" -> { log: "abc", at: 12 }; anything else -> null
export function parseCursor(cursor: string): { log: string, at: number } | null {
    const dot = cursor.lastIndexOf(".");
    if (dot <= 0) return null;
    const at = Number(cursor.slice(dot + 1));
    if (!Number.isInteger(at) || at < 0) return null;
    return { log: cursor.slice(0, dot), at };
}

// The position in `log` to read from, given what a device sent ("a.3,b.9").
export function positionFor(after: string, log: string, length: number): number {
    for (const part of after.split(",")) {
        const c = parseCursor(part.trim());
        if (c && c.log === log) return c.at <= length ? c.at : 0;
    }
    return 0;
}

// Keep the newest cursor for each node, most recently used first, at most MAX_CURSORS.
export function rememberCursor(cursors: string[], cursor: string): string[] {
    const c = parseCursor(cursor);
    if (!c) return cursors;
    const rest = cursors.filter(x => parseCursor(x)?.log !== c.log);
    return [cursor, ...rest].slice(0, MAX_CURSORS);
}
