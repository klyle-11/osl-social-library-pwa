import type { Op } from "./types";

// The file that carries someone's work between devices without a network:
// "Save my work" on a phone, then import on the node (or back onto a new phone).
export type Bundle = {
    format: "osl-bundle",
    version: 1,
    user: string,
    exported: string,
    ops: Op[],
    media: Record<string, string>   // hash -> data URL, only for media this person added
};

export function makeBundle(user: string, exported: string, ops: Op[], media: Record<string, string>): Bundle {
    return { format: "osl-bundle", version: 1, user, exported, ops, media };
}

// Shape check only; each op still goes through validateOp on import.
export function readBundle(input: unknown): { ok: true, ops: unknown[], media: Record<string, string> } | { ok: false, reason: string } {
    if (typeof input !== "object" || input === null) return { ok: false, reason: "not a bundle" };
    const b = input as Record<string, unknown>;
    if (b.format !== "osl-bundle") return { ok: false, reason: "not an OSL bundle" };
    if (b.version !== 1) return { ok: false, reason: `unsupported bundle version ${String(b.version)}` };
    if (!Array.isArray(b.ops)) return { ok: false, reason: "bundle has no ops" };
    const media: Record<string, string> = {};
    if (typeof b.media === "object" && b.media !== null) {
        for (const [k, v] of Object.entries(b.media)) if (typeof v === "string") media[k] = v;
    }
    return { ok: true, ops: b.ops, media };
}

// What the node hands out as the steward catalog: documents plus who may moderate.
export type Catalog = { stewards: string[], ops: unknown[] };

export function readCatalog(input: unknown): Catalog {
    if (typeof input !== "object" || input === null) return { stewards: [], ops: [] };
    const c = input as Record<string, unknown>;
    return {
        stewards: Array.isArray(c.stewards) ? c.stewards.filter((s): s is string => typeof s === "string") : [],
        ops: Array.isArray(c.ops) ? c.ops : []
    };
}
