// A short random device id, e.g. "d-7q2kx9ma". getRandomValues works on plain
// http too (randomUUID doesn't), so this is safe on a laptop node without HTTPS.
const ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";

export function newDeviceId(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(8));
    let id = "d-";
    for (const b of bytes) id += ALPHABET[b % ALPHABET.length];
    return id;
}

export function now(): string {
    return new Date().toISOString();
}

// Small settings that belong to this device rather than to the library's op log
// (a pairing token, a preference). Storage can be blocked, so both directions are guarded.
export function remember(key: string, value: string | null): void {
    try {
        if (value === null) localStorage.removeItem("osl:device:" + key);
        else localStorage.setItem("osl:device:" + key, value);
    } catch { /* it just won't survive a reload */ }
}

export function recall(key: string): string | null {
    try {
        return localStorage.getItem("osl:device:" + key);
    } catch {
        return null;
    }
}
