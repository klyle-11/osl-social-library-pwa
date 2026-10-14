// The contract. Every contribution is an immutable op; everything on screen
// is derived from the op log (see views.ts). Nothing here touches the DOM.

type Access = "public" | "private" | "anonymous";

type DocumentMedium =
    | "essay" | "book" | "poem" | "shortFilm" | "film"
    | "photo" | "letter" | "audio" | "other"
    | "";   // unspecified

type User = {
    id: string,     // the device id for now (one device = one user)
    name?: string
};

type DocumentProperties = {
    author: string,
    title: string,
    subtitle?: string,
    type: DocumentMedium,
    year?: string,
    description?: string,
    alt?: string    // describing an image counts as a contribution
};

// `${user}:${counter}` — device id plus a counter that only goes up
type OpId = string;

// `${owner}/${name}` — the owner is readable from the id itself
type CollectionId = string;

type OpBase = {
    id: OpId,
    user: string,
    timestamp: string   // ISO 8601, UTC. Display order only, never correctness.
};

// a LibraryDocument's id is the id of the op that added it
type LibraryDocument = OpBase & {
    type: "document",
    url?: string,
    hash?: string,      // content address of attached media, e.g. "sha256-9f2c…"
    fileType: string,   // "image/jpeg", "link", "text", …
    properties: DocumentProperties
};

type Annotation = OpBase & {
    type: "annotation",
    target: OpId,       // the document it's about
    body: string,
    access: Access
};

type AddToCollection = OpBase & {
    type: "add-to-collection",
    collectionId: CollectionId,
    documentId: OpId
};

type RemoveFromCollection = OpBase & {
    type: "remove-from-collection",
    collectionId: CollectionId,
    documentId: OpId
};

type NameCollection = OpBase & {
    type: "name-collection",
    collectionId: CollectionId,
    name: string
};

type NameUser = OpBase & {
    type: "name-user",
    name: string
};

type Hide = OpBase & {
    type: "hide",
    target: OpId
};

// which of a document's properties a person can fill in or correct afterwards
type DescribeField = "title" | "subtitle" | "author" | "type" | "year" | "description" | "alt";

// metadata is contributed like anything else: one small op per field, latest wins
type Describe = OpBase & {
    type: "describe",
    target: OpId,       // the document being described
    field: DescribeField,
    value: string
};

type Op =
    | LibraryDocument
    | Annotation
    | AddToCollection
    | RemoveFromCollection
    | NameCollection
    | NameUser
    | Hide
    | Describe;

type OpType = Op["type"];

// same id, different payload: never silently overwritten
type Conflict = {
    id: OpId,
    kept: Op,
    rejected: Op
};

// what the create functions need from the outside world, passed in so they stay pure
type OpContext = {
    user: string,
    seq: number,
    timestamp: string
};

// Link / CommentBodyPosition (passage anchors) are parked for the reader subproject.

// ---- presence: who is here right now. Never an op: not stored, not merged, not sent by radio. ----

type PresenceEntry = {
    user: string,
    viewing: OpId | ""      // the document they have open, if any
};

// what the presenting screen is showing to the room
type Showing = {
    documentId: OpId,
    by: string,
    since: string
};

type Presence = {
    online: PresenceEntry[],
    showing: Showing | null
};

export type {
    Access, DocumentMedium, User, DocumentProperties, OpId, CollectionId,
    OpBase, LibraryDocument, Annotation, AddToCollection, RemoveFromCollection,
    NameCollection, NameUser, Hide, DescribeField, Describe, Op, OpType, Conflict, OpContext,
    PresenceEntry, Showing, Presence
};
