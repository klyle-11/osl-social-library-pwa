import type { Conflict, Op } from "./types";

// JSON with sorted keys, so two ops with the same fields in a different
// key order compare equal.
export function canonical(value: unknown): string {
    if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
    if (value !== null && typeof value === "object") {
        const o = value as Record<string, unknown>;
        const keys = Object.keys(o).filter(k => o[k] !== undefined).sort();
        return `{${keys.map(k => `${JSON.stringify(k)}:${canonical(o[k])}`).join(",")}}`;
    }
    return JSON.stringify(value);
}

// Display/log order: timestamp, then id to break ties the same way everywhere.
export function compareOps(a: Op, b: Op): number {
    if (a.timestamp !== b.timestamp) return a.timestamp < b.timestamp ? -1 : 1;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

export type MergeResult = { ops: Op[], conflicts: Conflict[] };

// Set union by id. Commutative, associative, idempotent.
// Same id + same payload = duplicate, dropped.
// Same id + different payload = conflict: reported, and the winner is picked by
// comparing canonical forms, so every device picks the same one regardless of order.
export function mergeOps(...logs: Op[][]): MergeResult {
    // every distinct version seen for each id
    const versions = new Map<string, Map<string, Op>>();
    for (const log of logs) {
        for (const op of log) {
            let v = versions.get(op.id);
            if (!v) versions.set(op.id, v = new Map());
            v.set(canonical(op), op);
        }
    }

    const ops: Op[] = [];
    const conflicts: Conflict[] = [];
    for (const [id, v] of versions) {
        const keys = [...v.keys()].sort();
        const kept = v.get(keys[0])!;
        ops.push(kept);
        for (const k of keys.slice(1)) conflicts.push({ id, kept, rejected: v.get(k)! });
    }

    ops.sort(compareOps);
    conflicts.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    return { ops, conflicts };
}
