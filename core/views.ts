import { collectionOwner, keptCollectionId } from "./ops";
import { compareOps } from "./merge";
import type {
    AddToCollection, Annotation, CollectionId, Describe, DescribeField, DocumentMedium, LibraryDocument,
    NameCollection, Op, OpId
} from "./types";

// Everything a person sees, computed from the op log. Delete it all and it can
// be rebuilt from the ops — none of this is ever stored as the source of truth.

export type ViewOptions = {
    viewer: string,         // whose screen this is (private annotations, "mine")
    stewards: string[]      // users who may hide anyone's contributions
};

export type CollectionView = {
    id: CollectionId,
    owner: string,
    name: string | null,
    documentIds: OpId[],    // in the order they were added
    updated: string
};

export type AnnotationView = {
    op: Annotation,
    anonymous: boolean,
    mine: boolean
};

// who last filled in a field, so the screen can credit them
export type DetailCredit = { user: string, timestamp: string };

export type FeedEntry =
    | { kind: "document", op: LibraryDocument }
    | { kind: "describe", op: Describe, documentId: OpId }
    | { kind: "annotation", op: Annotation, documentId: OpId }
    | { kind: "collect", op: AddToCollection, documentId: OpId }
    | { kind: "collection", op: NameCollection };

export type LibraryViews = {
    documents: Record<OpId, LibraryDocument>,
    documentOrder: OpId[],                          // newest first
    credits: Record<OpId, Partial<Record<DescribeField, DetailCredit>>>,
    feed: FeedEntry[],                              // newest first
    collections: Record<CollectionId, CollectionView>,
    collectionOrder: CollectionId[],                // most recently updated first
    collectionsByDocument: Record<OpId, CollectionId[]>,
    threads: Record<OpId, AnnotationView[]>,        // oldest first, like a conversation
    names: Record<string, string>
};

export const KEPT_NAME = "Kept";

export function buildViews(ops: Op[], options: ViewOptions): LibraryViews {
    const log = [...ops].sort(compareOps);
    const byId = new Map(log.map(op => [op.id, op]));
    const stewards = new Set(options.stewards);

    // 1. hides: allowed for the target's own author, or a steward
    const hidden = new Set<OpId>();
    for (const op of log) {
        if (op.type !== "hide") continue;
        const target = byId.get(op.target);
        if (target && (target.user === op.user || stewards.has(op.user))) hidden.add(op.target);
    }

    // 2. names: last writer wins, per user (a user can only name themselves)
    const names: Record<string, string> = {};
    for (const op of log) if (op.type === "name-user") names[op.user] = op.name;

    // 3. documents
    const documents: Record<OpId, LibraryDocument> = {};
    for (const op of log) if (op.type === "document" && !hidden.has(op.id)) documents[op.id] = op;
    const documentOrder = Object.keys(documents).reverse();

    // 3b. details people filled in afterwards: latest wins, field by field.
    //     The document shown is a copy, so the original op is never altered.
    const credits: Record<OpId, Partial<Record<DescribeField, DetailCredit>>> = {};
    const describesInFeed: Describe[] = [];
    for (const op of log) {
        if (op.type !== "describe" || hidden.has(op.id)) continue;
        const doc = documents[op.target];
        if (!doc) continue;
        const properties = { ...doc.properties };
        if (op.field === "type") properties.type = op.value as DocumentMedium;
        else if (op.field === "title" || op.field === "author") properties[op.field] = op.value;
        else if (op.value === "") delete properties[op.field];
        else properties[op.field] = op.value;
        documents[op.target] = { ...doc, properties };
        (credits[op.target] ??= {})[op.field] = { user: op.user, timestamp: op.timestamp };
        describesInFeed.push(op);
    }

    // 4. collections: only the owner may add, remove, or name.
    //    membership of each (collection, document) pair is last-writer-wins.
    const collections: Record<CollectionId, CollectionView> = {};
    const membership = new Map<string, Op>();           // "collection\ndocument" -> latest add/remove
    const firstNaming = new Map<CollectionId, NameCollection>();

    const touch = (id: CollectionId, when: string): CollectionView => {
        let c = collections[id];
        if (!c) {
            c = collections[id] = { id, owner: collectionOwner(id), name: null, documentIds: [], updated: when };
            if (id === keptCollectionId(c.owner)) c.name = KEPT_NAME;
        }
        if (when > c.updated) c.updated = when;
        return c;
    };

    for (const op of log) {
        if (op.type !== "add-to-collection" && op.type !== "remove-from-collection" && op.type !== "name-collection") continue;
        if (collectionOwner(op.collectionId) !== op.user || hidden.has(op.id)) continue;
        if (op.type === "name-collection") {
            touch(op.collectionId, op.timestamp).name = op.name;
            if (!firstNaming.has(op.collectionId)) firstNaming.set(op.collectionId, op);
        } else {
            // a collection exists once it's been touched, even if it's emptied later
            touch(op.collectionId, op.timestamp);
            membership.set(`${op.collectionId}\n${op.documentId}`, op);
        }
    }

    const collectsInFeed: AddToCollection[] = [];
    const collectionsByDocument: Record<OpId, CollectionId[]> = {};
    // walk membership in log order so documentIds come out in the order they were added
    const members = [...membership.values()].sort(compareOps);
    for (const op of members) {
        if (op.type !== "add-to-collection" || !documents[op.documentId]) continue;
        const c = touch(op.collectionId, op.timestamp);
        c.documentIds.push(op.documentId);
        (collectionsByDocument[op.documentId] ??= []).push(op.collectionId);
        collectsInFeed.push(op);
    }
    const collectionOrder = Object.values(collections)
        .sort((a, b) => (a.updated === b.updated ? (a.id < b.id ? 1 : -1) : a.updated < b.updated ? 1 : -1))
        .map(c => c.id);

    // 5. annotation threads: private ones only for their author
    const threads: Record<OpId, AnnotationView[]> = {};
    const annotationsInFeed: Annotation[] = [];
    for (const op of log) {
        if (op.type !== "annotation" || hidden.has(op.id) || !documents[op.target]) continue;
        const mine = op.user === options.viewer;
        if (op.access === "private" && !mine) continue;
        (threads[op.target] ??= []).push({ op, anonymous: op.access === "anonymous", mine });
        if (op.access !== "private") annotationsInFeed.push(op);
    }

    // 6. the feed: what happened, newest first. Chronological, no ranking.
    const feed: FeedEntry[] = [];
    for (const id of Object.keys(documents)) feed.push({ kind: "document", op: documents[id] });
    for (const op of describesInFeed) feed.push({ kind: "describe", op, documentId: op.target });
    for (const op of annotationsInFeed) feed.push({ kind: "annotation", op, documentId: op.target });
    for (const op of collectsInFeed) feed.push({ kind: "collect", op, documentId: op.documentId });
    for (const op of firstNaming.values()) feed.push({ kind: "collection", op });
    feed.sort((a, b) => compareOps(b.op, a.op));

    return { documents, documentOrder, credits, feed, collections, collectionOrder, collectionsByDocument, threads, names };
}
