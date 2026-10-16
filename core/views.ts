import { collectionOwner, keptCollectionId } from "./ops";
import { compareOps } from "./merge";
import { EVERYONE, NO_IDENTITY, OWNER, inAudience, parseAudience, personOf, type Audience } from "./access";
import type {
    AddToCollection, Annotation, CollectionId, Describe, DescribeField, DocumentMedium, Identity, LibraryDocument,
    NameCollection, Op, OpId
} from "./types";

// Everything a person sees, computed from the op log. Delete it all and it can
// be rebuilt from the ops — none of this is ever stored as the source of truth.

export type ViewOptions = {
    viewer: string,         // whose screen this is (private annotations, "mine")
    stewards: string[],     // users (devices or accounts) who may hide anyone's contributions
    identity?: Identity,    // which devices are whose accounts, and the groups (from the node)
    accounts?: Record<string, string>   // accounts' names (from the node), passed through for the screen
};

export type CollectionView = {
    id: CollectionId,
    owner: string,          // the person: an account, or a guest's device
    name: string | null,
    documentIds: OpId[],    // in the order they were added
    addedBy: Record<OpId, string>,  // the device that put each one in
    updated: string,
    see: Audience,          // who may see it (everyone, unless the owner says otherwise)
    add: Audience,          // who may add to it (only the owner, unless they say otherwise)
    mine: boolean,          // the viewer owns it
    mayAdd: boolean         // the viewer may add to it
};

export type AnnotationView = {
    op: Annotation,
    anonymous: boolean,
    mine: boolean,
    depth: number,              // 0 for a note on the document, 1 for a reply to it, …
    parent: Annotation | null   // the note it answers, when that note is visible here
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
    threads: Record<OpId, AnnotationView[]>,        // oldest first, like a conversation; each reply right under what it answers
    names: Record<string, string>,                  // what guests call themselves (name-user ops), by device
    people: string[],                               // everyone who has done anything here, as people, most recent first
    devices: Record<string, string>,                // device -> account, from the node's directory
    accounts: Record<string, string>,               // account -> name, from the node's directory
    // notes the uploader pinned as prompts, in their order: only ones everyone can see
    prompts: Record<OpId, Annotation[]>
};

export const KEPT_NAME = "Kept";

export function buildViews(ops: Op[], options: ViewOptions): LibraryViews {
    const log = [...ops].sort(compareOps);
    const byId = new Map(log.map(op => [op.id, op]));
    const identity = options.identity ?? NO_IDENTITY;
    const person = (user: string) => personOf(identity, user);
    const stewards = new Set(options.stewards);
    const isSteward = (user: string) => stewards.has(user) || stewards.has(person(user));
    const me = person(options.viewer);

    // 1. hides: allowed for the target's own author, or a steward
    const hidden = new Set<OpId>();
    for (const op of log) {
        if (op.type !== "hide") continue;
        const target = byId.get(op.target);
        if (target && (person(target.user) === person(op.user) || isSteward(op.user))) hidden.add(op.target);
    }

    // 2. names: last writer wins, per user (a user can only name themselves)
    const names: Record<string, string> = {};
    for (const op of log) if (op.type === "name-user") names[op.user] = op.name;
    // everyone who has done anything here, most recent first: who an uploader can choose from
    const people = [...new Set([...log].reverse().map(op => person(op.user)))];

    // 3. documents
    const documents: Record<OpId, LibraryDocument> = {};
    for (const op of log) if (op.type === "document" && !hidden.has(op.id)) documents[op.id] = op;
    const documentOrder = Object.keys(documents).reverse();

    // 3b. details people filled in afterwards: latest wins, field by field.
    //     The document shown is a copy, so the original op is never altered.
    //     Who may fill them in is the uploader's choice (the "editors" detail), as it
    //     stood when the edit was made: only the uploader or a steward may change it.
    const credits: Record<OpId, Partial<Record<DescribeField, DetailCredit>>> = {};
    const describesInFeed: Describe[] = [];
    for (const op of log) {
        if (op.type !== "describe" || hidden.has(op.id)) continue;
        const doc = documents[op.target];
        if (!doc) continue;
        const owner = person(op.user) === person(doc.user) || isSteward(op.user);
        // who may edit, and which notes are pinned as prompts, are the uploader's (or a steward's) to set
        const ownerOnly = op.field === "editors" || op.field === "prompts";
        if (ownerOnly ? !owner || (op.field === "editors" && parseEditors(op.value) === null) : !mayEdit(doc, op.user, stewards, identity)) {
            // a document nobody has pictured yet takes its first thumbnail from whoever opens it
            if (!(op.field === "thumbnail" && !doc.properties.thumbnail && !owner && op.value)) continue;
        }
        const properties = { ...doc.properties };
        if (op.field === "type") properties.type = op.value as DocumentMedium;
        else if (op.field === "title" || op.field === "author") properties[op.field] = op.value;
        else if (op.value === "") delete properties[op.field];
        else properties[op.field] = op.value;
        documents[op.target] = { ...doc, properties };
        // a thumbnail is made by the app and who-may-edit is a setting: no credit, nothing in the feed
        if (op.field === "thumbnail" || op.field === "editors" || op.field === "prompts") continue;
        (credits[op.target] ??= {})[op.field] = { user: op.user, timestamp: op.timestamp };
        describesInFeed.push(op);
    }

    // 4. collections: the owner names it and says who may see it and who may add to it
    //    (collection-access ops; latest wins, and an add counts if it was allowed when it
    //    was made). Whoever added a document may take it out; the owner may take out anything.
    //    Membership of each (collection, document) pair is last-writer-wins.
    const collections: Record<CollectionId, CollectionView> = {};
    const membership = new Map<string, Op>();           // "collection\ndocument" -> latest add/remove
    const firstNaming = new Map<CollectionId, NameCollection>();
    const access = new Map<CollectionId, { see: Audience, add: Audience }>();

    const touch = (id: CollectionId, when: string): CollectionView => {
        let c = collections[id];
        if (!c) {
            const owner = person(collectionOwner(id));
            c = collections[id] = {
                id, owner, name: null, documentIds: [], addedBy: {}, updated: when,
                see: EVERYONE, add: OWNER, mine: owner === me, mayAdd: owner === me
            };
            if (id === keptCollectionId(collectionOwner(id))) c.name = KEPT_NAME;
        }
        if (when > c.updated) c.updated = when;
        return c;
    };

    for (const op of log) {
        if (op.type !== "add-to-collection" && op.type !== "remove-from-collection" && op.type !== "name-collection" && op.type !== "collection-access") continue;
        if (hidden.has(op.id)) continue;
        const owner = person(collectionOwner(op.collectionId));
        const who = person(op.user);
        if (op.type === "collection-access") {
            if (who !== owner) continue;
            const see = parseAudience(op.see), add = parseAudience(op.add);
            if (!see || !add) continue;
            access.set(op.collectionId, { see, add });
            touch(op.collectionId, op.timestamp);
            continue;
        }
        if (op.type === "name-collection") {
            if (who !== owner) continue;
            touch(op.collectionId, op.timestamp).name = op.name;
            if (!firstNaming.has(op.collectionId)) firstNaming.set(op.collectionId, op);
            continue;
        }
        const key = `${op.collectionId}\n${op.documentId}`;
        if (who !== owner) {
            const rules = access.get(op.collectionId);
            if (!rules || !inAudience(rules.add, who, owner, identity)) continue;
            if (op.type === "remove-from-collection") {
                const last = membership.get(key);
                if (!last || last.type !== "add-to-collection" || person(last.user) !== who) continue;
            }
        }
        // a collection exists once it's been touched, even if it's emptied later
        touch(op.collectionId, op.timestamp);
        membership.set(key, op);
    }

    // what this viewer may see: a collection that isn't for them isn't there at all
    for (const [id, c] of Object.entries(collections)) {
        const rules = access.get(id);
        if (rules) { c.see = rules.see; c.add = rules.add; }
        if (!inAudience(c.see, me, c.owner, identity)) { delete collections[id]; continue; }
        c.mayAdd = inAudience(c.add, me, c.owner, identity);
    }

    const collectsInFeed: AddToCollection[] = [];
    const collectionsByDocument: Record<OpId, CollectionId[]> = {};
    // walk membership in log order so documentIds come out in the order they were added
    const members = [...membership.values()].sort(compareOps);
    for (const op of members) {
        if (op.type !== "add-to-collection" || !documents[op.documentId]) continue;
        const c = collections[op.collectionId];
        if (!c) continue;
        if (op.timestamp > c.updated) c.updated = op.timestamp;
        c.documentIds.push(op.documentId);
        c.addedBy[op.documentId] = op.user;
        (collectionsByDocument[op.documentId] ??= []).push(op.collectionId);
        collectsInFeed.push(op);
    }
    const collectionOrder = Object.values(collections)
        .sort((a, b) => (a.updated === b.updated ? (a.id < b.id ? 1 : -1) : a.updated < b.updated ? 1 : -1))
        .map(c => c.id);

    // 5. annotation threads: private ones only for their author
    const threads: Record<OpId, AnnotationView[]> = {};
    const annotationsInFeed: Annotation[] = [];
    const visible: Record<OpId, Annotation[]> = {};
    for (const op of log) {
        if (op.type !== "annotation" || hidden.has(op.id) || !documents[op.target]) continue;
        const mine = person(op.user) === me;
        if (op.access === "private" && !mine) continue;
        (visible[op.target] ??= []).push(op);
        if (op.access !== "private") annotationsInFeed.push(op);
    }
    //    replies sit under what they answer, oldest first at every level. A reply whose
    //    note is hidden, private to someone else, or on another document stands on its own.
    for (const [doc, notes] of Object.entries(visible)) {
        const here = new Map(notes.map(n => [n.id, n]));
        const children = new Map<OpId, Annotation[]>();
        const roots: Annotation[] = [];
        for (const n of notes) {
            const parent = n.replyTo && n.replyTo !== n.id ? here.get(n.replyTo) : undefined;
            if (parent) (children.get(parent.id) ?? children.set(parent.id, []).get(parent.id)!).push(n);
            else roots.push(n);
        }
        const out: AnnotationView[] = [];
        const placed = new Set<OpId>();
        const walk = (n: Annotation, depth: number, parent: Annotation | null) => {
            if (placed.has(n.id)) return;   // a loop of replies can't hang the page
            placed.add(n.id);
            out.push({ op: n, anonymous: n.access === "anonymous", mine: person(n.user) === me, depth, parent });
            for (const c of children.get(n.id) ?? []) walk(c, depth + 1, n);
        };
        for (const r of roots) walk(r, 0, null);
        for (const n of notes) walk(n, 0, null);   // anything only reachable through a loop
        threads[doc] = out;
    }

    // 5b. prompts: the pinned notes, in the order pinned. A pinned note that is hidden,
    //     private or on another document isn't shown, and so can't put words in anyone's mouth.
    const prompts: Record<OpId, Annotation[]> = {};
    for (const [id, doc] of Object.entries(documents)) {
        if (!doc.properties.prompts) continue;
        const here = new Map((visible[id] ?? []).filter(n => n.access !== "private").map(n => [n.id, n]));
        const pinned = parsePrompts(doc.properties.prompts).map(p => here.get(p)).filter((n): n is Annotation => !!n);
        if (pinned.length) prompts[id] = pinned;
    }

    // 6. the feed: what happened, newest first. Chronological, no ranking.
    const feed: FeedEntry[] = [];
    for (const id of Object.keys(documents)) feed.push({ kind: "document", op: documents[id] });
    for (const op of describesInFeed) feed.push({ kind: "describe", op, documentId: op.target });
    for (const op of annotationsInFeed) feed.push({ kind: "annotation", op, documentId: op.target });
    for (const op of collectsInFeed) feed.push({ kind: "collect", op, documentId: op.documentId });
    for (const op of firstNaming.values()) if (collections[op.collectionId]) feed.push({ kind: "collection", op });
    feed.sort((a, b) => compareOps(b.op, a.op));

    return {
        documents, documentOrder, credits, feed, collections, collectionOrder, collectionsByDocument, threads,
        names, people, devices: identity.devices, accounts: options.accounts ?? {}, prompts
    };
}

// "<note id>,<note id>": the pinned notes, first pinned first; no repeats
export function parsePrompts(value: string | undefined): OpId[] {
    return [...new Set((value ?? "").split(",").map(s => s.trim()).filter(Boolean))];
}

// Who may change a document's details. People are accounts, groups, or (from before
// accounts) guests' devices.
export type Editors = { kind: "everyone" } | { kind: "owner" } | { kind: "people", users: string[] };

// "everyone" | "owner" | "people:a,b"; null for anything else (that op is ignored)
export function parseEditors(value: string | undefined): Editors | null {
    if (!value || value === "everyone") return { kind: "everyone" };
    if (value === "owner") return { kind: "owner" };
    if (value.startsWith("people:")) return { kind: "people", users: value.slice(7).split(",").filter(Boolean) };
    return null;
}

export function formatEditors(e: Editors): string {
    return e.kind === "people" ? `people:${e.users.join(",")}` : e.kind;
}

// may this user change this document's details now? The uploader and stewards always may.
export function mayEdit(doc: LibraryDocument, user: string, stewards: ReadonlySet<string> | readonly string[], identity: Identity = NO_IDENTITY): boolean {
    const list = stewards instanceof Set ? stewards : new Set(stewards as readonly string[]);
    const who = personOf(identity, user);
    if (who === personOf(identity, doc.user) || list.has(user) || list.has(who)) return true;
    const e = parseEditors(doc.properties.editors) ?? { kind: "everyone" };
    if (e.kind !== "people") return e.kind === "everyone";
    // a device listed before its person signed in still counts
    return e.users.includes(user) || inAudience({ kind: "people", ids: e.users }, who, "", identity);
}
