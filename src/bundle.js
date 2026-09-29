// "Save my collection": pack ops + media into one file and hand it to the
// share sheet (iOS: Save to Files / AirDrop; Android: Drive, Nearby Share...).
// The same file can be imported on another phone with no network at all.

import { makeBundle, readBundle, mediaHashes } from "./contract.js";
import { getMedia, putMedia, putRemoteOps, hashBlob } from "./db.js";

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1]);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });
}

function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
}

export async function buildBundleFile(ops, filename) {
    const manifest = [];
    const files = {};
    for (const hash of mediaHashes(ops)) {
        const blob = await getMedia(hash);
        if (!blob) continue;
        const item = ops.find((op) => op.hash === hash);
        manifest.push({ hash, name: (item && item.name) || hash, bytes: blob.size, type: blob.type });
        files[hash] = await blobToBase64(blob);
    }
    const bundle = { ...makeBundle(ops, manifest), files };
    return new File([JSON.stringify(bundle)], filename, { type: "application/json" });
}

/** Share if the platform can share files, otherwise download. */
export async function shareOrDownload(file) {
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
        try {
            await navigator.share({ files: [file], title: file.name });
            return "shared";
        } catch (e) {
            if (e.name === "AbortError") return "cancelled";
        }
    }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(file);
    a.download = file.name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    return "downloaded";
}

export async function importBundleFile(file) {
    const bundle = readBundle(await file.text());
    let media = 0;
    for (const entry of bundle.manifest || []) {
        const b64 = bundle.files && bundle.files[entry.hash];
        if (!b64) continue;
        const blob = base64ToBlob(b64, entry.type);
        if ((await hashBlob(blob)) !== entry.hash) continue; // corrupted: skip
        await putMedia(entry.hash, blob, entry.type);
        media++;
    }
    await putRemoteOps(bundle.ops, true);
    return { ops: bundle.ops.length, media };
}
