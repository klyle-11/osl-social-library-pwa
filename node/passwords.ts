// Passwords are never stored, only what they hash to, with the salt and the cost, in one
// string that says how it was made:
//   scrypt$<N>$<r>$<p>$<salt>$<hash>        accounts (kept on the library only)
//   pbkdf2-sha256$<iterations>$<salt>$<hash> libraries (a drop point checks these too,
//                                            and its chip has PBKDF2 but no scrypt)
// Salts and hashes are base64url.
import { pbkdf2, randomBytes, scrypt, timingSafeEqual } from "node:crypto";

const SCRYPT = { N: 16384, r: 8, p: 1 };   // about 16 MB and a tenth of a second on a Pi 4
// A drop point checks a library's password in a second or two at this count. It is lower
// than for accounts because the board is slow, and the hash is on the board (W-D12).
export const LIBRARY_ITERATIONS = 100_000;
const KEY_BYTES = 32;

const b64 = (b: Buffer) => b.toString("base64url");

function scryptAsync(password: string, salt: Buffer, n: number, r: number, p: number): Promise<Buffer> {
    return new Promise((ok, fail) =>
        scrypt(password, salt, KEY_BYTES, { N: n, r, p, maxmem: 64 * 1024 * 1024 }, (e, key) => (e ? fail(e) : ok(key))));
}

function pbkdf2Async(password: string, salt: Buffer, iterations: number): Promise<Buffer> {
    return new Promise((ok, fail) => pbkdf2(password, salt, iterations, KEY_BYTES, "sha256", (e, key) => (e ? fail(e) : ok(key))));
}

export async function hashAccountPassword(password: string): Promise<string> {
    const salt = randomBytes(16);
    const key = await scryptAsync(password, salt, SCRYPT.N, SCRYPT.r, SCRYPT.p);
    return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${b64(salt)}$${b64(key)}`;
}

export async function hashLibraryPassword(password: string, iterations = LIBRARY_ITERATIONS): Promise<string> {
    const salt = randomBytes(16);
    const key = await pbkdf2Async(password, salt, iterations);
    return `pbkdf2-sha256$${iterations}$${b64(salt)}$${b64(key)}`;
}

// false for a wrong password and for anything that isn't a hash this node makes
export async function verifyPassword(stored: string, password: string): Promise<boolean> {
    const parts = stored.split("$");
    let key: Buffer, want: Buffer;
    if (parts[0] === "scrypt" && parts.length === 6) {
        const [n, r, p] = parts.slice(1, 4).map(Number);
        if (![n, r, p].every(Number.isInteger) || n > 1 << 20 || r > 32 || p > 16) return false;
        want = Buffer.from(parts[5], "base64url");
        key = await scryptAsync(password, Buffer.from(parts[4], "base64url"), n, r, p);
    } else if (parts[0] === "pbkdf2-sha256" && parts.length === 4) {
        const iterations = Number(parts[1]);
        if (!Number.isInteger(iterations) || iterations < 1 || iterations > 10_000_000) return false;
        want = Buffer.from(parts[3], "base64url");
        key = await pbkdf2Async(password, Buffer.from(parts[2], "base64url"), iterations);
    } else {
        return false;
    }
    return key.length === want.length && timingSafeEqual(key, want);
}
