// The contract (gate one): the shape of every operation, plus pure functions
// that merge op logs and derive views. No DOM, network, storage or clock here,
// so this file runs the same on a phone, on the node, and in tests.
//
// Carries over the annotation project's types:
//   Document   -> an `item` op   (url, hash, fileType, properties)
//   Annotation -> a `comment` op (body, access, attachments, links)

/** @typedef {"public" | "private" | "anonymous"} Access */
/** @typedef {"essay" | "book" | "poem" | "shortFilm" | "film" | ""} DocumentMedium */

/**
 * @typedef {Object} DocumentProperties
 * @property {string} author
 * @property {string} title
 * @property {string} [subtitle]
 * @property {DocumentMedium} type
 */

/**
 * @typedef {Object} Link
 * @property {string} [commentId]
 * @property {string} [documentId]
 */

/**
 * @typedef {Object} Op
 * @property {string} id        `${deviceId}:${counter}` - unique forever
 * @property {"item"|"comment"|"add-to-collection"|"name-collection"|"hide"} type
 * @property {string} author    device (or person) that made it
 * @property {string} created   ISO 8601 UTC
 * @property {string} [target]  item id, collection id, or op id (hide)
 *
 * item:              url?, hash?, fileType?, name?, properties
 * comment:           body, access, attachments? (hashes), links?
 * add-to-collection: target = collection id, item
 * name-collection:   target = collection id, name
 * hide:              target = any op id
 */

export const OP_TYPES = ["item", "comment", "add-to-collection", "name-collection", "hide"];
export const ACCESS = ["public", "private", "anonymous"];
export const MEDIUMS = ["", "essay", "book", "poem", "shortFilm", "film"];

/** Returns an error message, or null if the op matches the contract. */
export function validateOp(op) {
    if (!op || typeof op !== "object") return "not an object";
    if (typeof op.id !== "string" || !/^[^:]+:\d+$/.test(op.id)) return "bad id";
    if (!OP_TYPES.includes(op.type)) return "bad type";
    if (typeof op.author !== "string" || !op.author) return "bad author";
    if (typeof op.created !== "string" || isNaN(Date.parse(op.created))) return "bad created";
    switch (op.type) {
        case "item":
            if (!op.properties || typeof op.properties.title !== "string") return "item needs properties.title";
            if (!op.url && !op.hash) return "item needs url or hash";
            return null;
        case "comment":
            if (typeof op.target !== "string") return "comment needs target";
            if (typeof op.body !== "string" || !op.body) return "comment needs body";
            if (!ACCESS.includes(op.access)) return "bad access";
            return null;
        case "add-to-collection":
            if (typeof op.target !== "string" || typeof op.item !== "string") return "needs target and item";
            return null;
        case "name-collection":
            if (typeof op.target !== "string" || typeof op.name !== "string") return "needs target and name";
            return null;
        case "hide":
            if (typeof op.target !== "string") return "hide needs target";
            return null;
    }
    return null;
}

/** Merge op lists: union by id. Commutative, associative, idempotent. */
export function merge(...lists) {
    const byId = new Map();
    for (const list of lists) for (const op of list) if (!byId.has(op.id)) byId.set(op.id, op);
    return sortOps([...byId.values()]);
}

/** Stable, deterministic order: created, then id. */
export function sortOps(ops) {
    return [...ops].sort((a, b) => (a.created < b.created ? -1 : a.created > b.created ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function hiddenSet(ops) {
    return new Set(ops.filter((op) => op.type === "hide").map((op) => op.target));
}

/** Derived view: the library feed, newest first. */
export function itemsView(ops) {
    const hidden = hiddenSet(ops);
    return sortOps(ops.filter((op) => op.type === "item" && !hidden.has(op.id))).reverse();
}

/** Derived view: comment thread for one item, oldest first. */
export function threadView(ops, itemId, viewer) {
    const hidden = hiddenSet(ops);
    return sortOps(
        ops.filter(
            (op) =>
                op.type === "comment" &&
                op.target === itemId &&
                !hidden.has(op.id) &&
                (op.access !== "private" || op.author === viewer),
        ),
    );
}

/**
 * Derived view: collections. A collection id is `${owner}/${slug}`.
 * Name is a last-writer-wins register; only the owner may name it.
 */
export function collectionsView(ops) {
    const hidden = hiddenSet(ops);
    /** @type {Map<string, {id: string, owner: string, name: string, items: string[]}>} */
    const out = new Map();
    const get = (id) => {
        if (!out.has(id)) out.set(id, { id, owner: id.split("/")[0], name: id.split("/").slice(1).join("/"), items: [] });
        return out.get(id);
    };
    for (const op of sortOps(ops)) {
        if (hidden.has(op.id)) continue;
        if (op.type === "add-to-collection") {
            const c = get(op.target);
            if (!c.items.includes(op.item)) c.items.push(op.item);
        } else if (op.type === "name-collection") {
            const c = get(op.target);
            if (op.author === c.owner) c.name = op.name;
        }
    }
    return [...out.values()];
}

/** All ops needed to rebuild one collection elsewhere: the collection ops, its items, their comments. */
export function collectionOps(ops, collectionId, viewer) {
    const c = collectionsView(ops).find((c) => c.id === collectionId);
    if (!c) return [];
    const items = new Set(c.items);
    return sortOps(
        ops.filter(
            (op) =>
                ((op.type === "add-to-collection" || op.type === "name-collection") && op.target === collectionId) ||
                (op.type === "item" && items.has(op.id)) ||
                (op.type === "comment" && items.has(op.target) && (op.access !== "private" || op.author === viewer)) ||
                op.type === "hide",
        ),
    );
}

/** Media hashes referenced by a set of ops. */
export function mediaHashes(ops) {
    const out = new Set();
    for (const op of ops) {
        if (op.type === "item" && op.hash) out.add(op.hash);
        if (op.type === "comment" && op.attachments) for (const h of op.attachments) out.add(h);
    }
    return [...out];
}

/** Bundle: the travel package (ops + manifest of media files). */
export function makeBundle(ops, manifest) {
    return { format: "osl-bundle", version: 1, ops: sortOps(ops), manifest };
}

export function readBundle(json) {
    const b = typeof json === "string" ? JSON.parse(json) : json;
    if (!b || b.format !== "osl-bundle" || !Array.isArray(b.ops)) throw new Error("Not an OSL bundle");
    const bad = b.ops.map(validateOp).find(Boolean);
    if (bad) throw new Error("Invalid op in bundle: " + bad);
    return b;
}
