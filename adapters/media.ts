// Photos people add: shrunk on the phone, then addressed by the hash of their bytes.

const MAX_SIDE = 1280;

export function fileToDataUrl(file: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result));
        r.onerror = () => reject(r.error);
        r.readAsDataURL(file);
    });
}

// downscale big camera photos so a few dozen fit in phone storage
export async function shrinkImage(file: File): Promise<string> {
    const original = await fileToDataUrl(file);
    const img = new Image();
    img.src = original;
    await img.decode();
    const scale = Math.min(1, MAX_SIDE / Math.max(img.naturalWidth, img.naturalHeight));
    if (scale === 1 && file.size < 400_000) return original;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(img.naturalWidth * scale);
    canvas.height = Math.round(img.naturalHeight * scale);
    canvas.getContext("2d")!.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.8);
}

// SHA-256 needs a secure context (https or localhost). On plain http we fall
// back to a weak hash, labelled as such so it can never be mistaken for sha256.
export async function hashData(data: string): Promise<string> {
    const bytes = new TextEncoder().encode(data);
    if (globalThis.crypto?.subtle) {
        const digest = await crypto.subtle.digest("SHA-256", bytes);
        return "sha256-" + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, "0")).join("");
    }
    let h = 0x811c9dc5;
    for (const b of bytes) h = Math.imul(h ^ b, 0x01000193) >>> 0;
    return "fnv1a-" + h.toString(16).padStart(8, "0") + "-" + bytes.length.toString(16);
}
