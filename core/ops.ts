import type {
    Access, AddToCollection, Annotation, CollectionId, Describe, DescribeField, DocumentProperties, Hide,
    LibraryDocument, NameCollection, NameUser, Op, OpContext, OpId, OpType,
    RemoveFromCollection
} from "./types";

export const OP_TYPES: readonly OpType[] = [
    "document", "annotation", "add-to-collection", "remove-from-collection",
    "name-collection", "name-user", "hide", "describe"
];

export const DESCRIBE_FIELDS: readonly DescribeField[] = [
    "title", "subtitle", "author", "type", "year", "description", "alt"
];

export const ACCESS: readonly Access[] = ["public", "private", "anonymous"];

// small on purpose: one op should fit a few LoRa packets at most
export const LIMITS = { body: 1000, name: 80, title: 200, text: 1000, url: 2000 };

export function makeOpId(user: string, seq: number): OpId {
    return `${user}:${seq}`;
}

export function parseOpId(id: string): { user: string, seq: number } | null {
    const i = id.lastIndexOf(":");
    if (i <= 0) return null;
    const seq = Number(id.slice(i + 1));
    if (!Number.isInteger(seq) || seq < 1) return null;
    return { user: id.slice(0, i), seq };
}

export function collectionOwner(collectionId: CollectionId): string {
    return collectionId.slice(0, collectionId.indexOf("/"));
}

export function keptCollectionId(user: string): CollectionId {
    return `${user}/kept`;
}

function base(ctx: OpContext) {
    return { id: makeOpId(ctx.user, ctx.seq), user: ctx.user, timestamp: ctx.timestamp };
}

// ---- create: pure, everything they need is passed in ----

export function createDocument(
    ctx: OpContext,
    fields: { url?: string, hash?: string, fileType: string, properties: DocumentProperties }
): LibraryDocument {
    return { ...base(ctx), type: "document", ...fields };
}

export function createAnnotation(ctx: OpContext, target: OpId, body: string, access: Access): Annotation {
    return { ...base(ctx), type: "annotation", target, body: body.trim(), access };
}

export function createAddToCollection(ctx: OpContext, collectionId: CollectionId, documentId: OpId): AddToCollection {
    return { ...base(ctx), type: "add-to-collection", collectionId, documentId };
}

export function createRemoveFromCollection(ctx: OpContext, collectionId: CollectionId, documentId: OpId): RemoveFromCollection {
    return { ...base(ctx), type: "remove-from-collection", collectionId, documentId };
}

export function createNameCollection(ctx: OpContext, collectionId: CollectionId, name: string): NameCollection {
    return { ...base(ctx), type: "name-collection", collectionId, name: name.trim() };
}

export function createNameUser(ctx: OpContext, name: string): NameUser {
    return { ...base(ctx), type: "name-user", name: name.trim() };
}

export function createHide(ctx: OpContext, target: OpId): Hide {
    return { ...base(ctx), type: "hide", target };
}

export function createDescribe(ctx: OpContext, target: OpId, field: DescribeField, value: string): Describe {
    return { ...base(ctx), type: "describe", target, field, value: value.trim() };
}

// ---- validate: anything from storage, a file, or the network goes through here ----

export type Validation = { ok: true, op: Op } | { ok: false, reason: string };

type Fields = Record<string, unknown>;

const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

function str(o: Fields, key: string, max: number, required = true): string | null {
    const v = o[key];
    if (v === undefined && !required) return null;
    if (typeof v !== "string") return `${key} must be a string`;
    if (required && v.trim() === "") return `${key} is empty`;
    if (v.length > max) return `${key} is longer than ${max}`;
    return null;
}

function collectionIdError(o: Fields): string | null {
    const e = str(o, "collectionId", 200);
    if (e) return e;
    const id = o.collectionId as string;
    const slash = id.indexOf("/");
    if (slash <= 0 || slash === id.length - 1) return "collectionId must look like owner/name";
    return null;
}

function checkFields(o: Fields): string | null {
    switch (o.type as OpType) {
        case "document": {
            const e = str(o, "fileType", 100) ?? str(o, "url", LIMITS.url, false) ?? str(o, "hash", 200, false);
            if (e) return e;
            const p = o.properties;
            if (typeof p !== "object" || p === null) return "properties missing";
            const pf = p as Fields;
            return str(pf, "title", LIMITS.title)
                ?? str(pf, "author", LIMITS.title, false)
                ?? str(pf, "subtitle", LIMITS.title, false)
                ?? str(pf, "year", 20, false)
                ?? str(pf, "description", LIMITS.text, false)
                ?? str(pf, "alt", LIMITS.text, false)
                ?? (typeof pf.type === "string" ? null : "properties.type must be a string");
        }
        case "annotation":
            return str(o, "target", 200) ?? str(o, "body", LIMITS.body)
                ?? (ACCESS.includes(o.access as Access) ? null : "access must be public, private or anonymous");
        case "add-to-collection":
        case "remove-from-collection":
            return collectionIdError(o) ?? str(o, "documentId", 200);
        case "name-collection":
            return collectionIdError(o) ?? str(o, "name", LIMITS.name);
        case "name-user":
            return str(o, "name", LIMITS.name);
        case "hide":
            return str(o, "target", 200);
        case "describe": {
            const e = str(o, "target", 200);
            if (e) return e;
            if (!DESCRIBE_FIELDS.includes(o.field as DescribeField)) return "field can't be described";
            if (typeof o.value !== "string") return "value must be a string";
            // a title can be corrected but not emptied; any other field can be cleared
            if (o.field === "title" && o.value.trim() === "") return "title is empty";
            const max = o.field === "description" || o.field === "alt" ? LIMITS.text : o.field === "year" ? 20 : LIMITS.title;
            return o.value.length > max ? `value is longer than ${max}` : null;
        }
    }
    return null;
}

export function validateOp(input: unknown): Validation {
    if (typeof input !== "object" || input === null || Array.isArray(input)) {
        return { ok: false, reason: "not an object" };
    }
    const o = input as Fields;
    if (!OP_TYPES.includes(o.type as OpType)) return { ok: false, reason: `unknown type ${String(o.type)}` };
    if (typeof o.id !== "string") return { ok: false, reason: "id must be a string" };
    const parsed = parseOpId(o.id);
    if (!parsed) return { ok: false, reason: "id must look like user:counter" };
    if (o.user !== parsed.user) return { ok: false, reason: "user must match the id's device" };
    if (typeof o.timestamp !== "string" || !ISO_UTC.test(o.timestamp)) {
        return { ok: false, reason: "timestamp must be ISO 8601 UTC" };
    }
    const e = checkFields(o);
    if (e) return { ok: false, reason: e };
    return { ok: true, op: input as Op };
}
