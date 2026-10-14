# OSL — Offline Social Library

*Developed for Maroon's Motherboard project.*

A communal, local-first library that feels like social media without the profit machinery. People scan a QR code, browse a feed of archive documents, keep documents in collections, annotate them, and take their collections home on their phone to work offline. Their contributions sync back to a node (a Pi or an old laptop) when they return. Later, they can also sync over LoRa radio without internet.

This README is the owner's reference: **what has been decided, why, what it costs, and the technical facts you need to keep in your head.** The work itself lives in [TODO.md](TODO.md). Source conversations and guides live in [docs/](docs/).

---

## Where the project is

| | |
|---|---|
| **Current gate** | Fast track (D13): a thin Gate one contract, then a Preact shell, then a seeded user test on phones |
| **Next gate** | Gate two, the node |
| **Who writes code** | You. Claude consults, explains, and gives hints only when asked (gauntlet rule: "a completed solution is not the default") |
| **Route map** | [docs/RR00_The_Whole_Route_Builders_Bridge.md](docs/RR00_The_Whole_Route_Builders_Bridge.md) |
| **Deep reference** | `docs/local_first_reader_build_guide_v0_1 (1).md` (RR01–RR13 modules) |
| **Latest design talk** | [docs/tiddlywikichat.md](docs/tiddlywikichat.md) |

### The seven gates (from RR00)

1. **Contract.** The op shapes, merge, derived views, bundle format, and fixtures. ← *you are here*
2. **Node.** A Pi or laptop stores the op log, serves the app, and runs a sync endpoint.
3. **HTTPS with no internet.** A real domain with a DNS-challenge certificate, and local DNS on the node.
4. **Web app.** IndexedDB, a service worker, a manifest, and install and export.
5. **Phone test.** Real iPhone and Android devices, airplane mode, and days offline.
6. **Workshop pilot.** Real people use it. **This is the cut line: gates 1–6 are a complete product.**
7. **Radio link.** An ESP32-S3 LoRa modem at the node, and an ESP32-S3 drop point in the field.

---

## Decisions log

Each entry says what was decided, what it costs, and where the decision came from. Add to this log as you go. A decision that isn't written down gets made again later.

### D1. Installed PWA is the product; no app store
- **Decision:** One HTML/CSS/JS codebase, delivered as a PWA that people add to their home screen. Capacitor stays in the parking lot.
- **Why:** An App Store install at a workshop is the friction you're trying to remove. Native iOS without the store is effectively impossible. Android sideloading is getting harder, with developer verification rolling out from 2026–2027.
- **Tradeoff:** You need HTTPS (see D8). On iPhone, the app has to be added to the home screen for durable storage, and iOS doesn't sync in the background.
- **Source:** tiddlywikichat.md, "Can it be done without putting an app in the store".

### D2. Preact for the UI, and only for the UI
- **Decision:** Preact 10 with function components, JSX, and hooks. Use `@preact/signals` for state and `createContext` to pass in adapters.
- **Why:** It keeps your React habits at a few KB. It bundles into one file, which keeps the quine/TiddlyWiki export possible. Signals fit "views derived from the op log".
- **Rejected:** **htmx**, because it's server-renders-HTML and your truth lives on the phone. **Alpine**, because it's per-element behavior with awkward shared state, and it needs its CSP build. **Mithril**, which works but is a new mental model with a small community. **Lit/web components**, the class-based option, which would mean a new style for you.
- **Tradeoff:** Avoid `preact/compat` and React libraries, because they quietly bloat the bundle. For routing, use something tiny like `preact-iso`, with an offline fallback to the cached shell.
- **Source:** tiddlywikichat.md, "im wanting to use a js framework thats lightweight…".

### D3. One repo, with a framework-free core
- **Decision:** Use the folders `core/`, `adapters/`, `app/`, and later `node/`. **Imports point one way:** `app → adapters → core`. `core` never imports `preact`, `app/`, or any browser API.
- **Test for where code belongs:** *Could it run in a plain test on the Pi, with no browser and no screen?* If yes, it's core. If it's about what a person sees or taps, it belongs in a component.
- **Why:** The Pi server (TypeScript on Node or Bun) imports the *same* validate and merge code as the phones, so the two can never disagree about what a valid op is.
- **Enforcement:** `core/` gets its own `tsconfig` with no DOM lib. Touching `document`, `window`, or `indexedDB` in core then fails to compile.
- **Tradeoff:** The ESP32 firmware is C/C++ and can't share this code. Shared JSON fixtures are how you keep it honest later.

### D4. Classes in core, function components in the UI, context for adapters
- **Decision:** Core services are TS classes behind interfaces, for example an op log and a `StorageAdapter` interface with `MemoryStorage` now and `IndexedDBStorage` in Gate four. Components call core methods; they never build ops. Signals hold changing state. Context says *which implementation* is in use.
- **Why:** Each shell swaps adapters without touching UI code: the PWA uses IndexedDB, a quine uses in-file JSON, and Capacitor would use SQLite.

### D5. Your vocabulary, not RR00's
- **Decision:** The contract uses your names. RR00's `item` → **`LibraryDocument`** (op type `document`). RR00's `comment` → **`Annotation`** (op type `annotation`). `Collection`, `Access`, `Link`, `User`, `DocumentProperties`, and `DocumentMedium` stay as they are.
- **One rename:** `Document` → `LibraryDocument`. `Document` is a built-in browser (DOM) type, and shadowing it causes confusing type errors the moment app code touches the DOM. A namespace workaround was rejected, because namespaces aren't erasable syntax (see T4).
- **When reading RR00:** translate item → LibraryDocument, comment → Annotation, and target → the document/annotation ID. The rest of the RR00 terms map directly.

### D6. Contributions are add-only ops (a grow-only set)
- **Decision:** Every contribution is an immutable op with a globally unique `id`. Merging is set union by `id`. Nothing is edited or deleted. "Hide" is its own op, and a collection's name uses last-writer-wins, where only the collection's owner may name it.
- **Why:** Merging this way is commutative, associative, and idempotent, so late, out-of-order, or doubled delivery all converge.
- **Tradeoff:** No shared prose editing, because two people editing one text body isn't supported. Corrections are follow-up ops. Hiding isn't erasing: copies that already left the node stay out there.
- **Build-guide rule (RR03):** Same `id` with a different payload is **not** a duplicate. Surface it as a conflict; never silently overwrite.

### D7. What you collect is what you carry; access is enforced at export
- **Decision:** A person's collections define their offline bundle. The bundle holds ops and metadata, plus media only on request. The node decides what goes into each bundle, because a client can't enforce permissions on data it already holds.
- **Tradeoff:** `Access: "private"` means nothing once a document is on a phone. Private material must simply never be packed.

### D8. HTTPS before offline testing
- A service worker won't install without HTTPS, except on `localhost`. Plain `http://library.local` can't work offline. The plan is a real domain, a DNS-challenge certificate, and local DNS on the node (Gate three). Let's Encrypt certificate lifetimes are getting shorter, so plan the renewal.

### D9. No federation (ActivityPub) for now
- It's public by default and deletion is best-effort, which conflicts with community-controlled access (Mukurtu, TK labels). If it ever happens, it's an opt-in gateway for each collection.

### D10. TiddlyWiki is an export format, not the app
- The PWA is the everyday app. A person's bundle can later be exported into a TiddlyWiki file (Quine on iOS, Tiddloid on Android, any laptop) and/or a zero-JS static HTML snapshot. Both are parking lot items.
- **Constraint this places on today's code:** no CDN scripts and no lazy-loaded chunks, so the bundle can always be inlined into one file.

### D11. The node can be any spare computer; the radios are ESP32-S3
- A Pi is fine, and so is an old laptop running Linux, which has a battery backup and more storage.
- Recommended boards are **LilyGO T3-S3 (SX1262, 915 MHz)** for the Pi-end modem and **Heltec WiFi LoRa 32 V4** for a solar drop point. The Heltec has built-in solar charging and 16 MB of flash; queue in LittleFS as an append-only file. If you buy Seeed, buy the XIAO ESP32S3 + Wio-SX1262 **kit**, which has no microSD slot.

### D12. Build tooling: esbuild (kept) over Vite
- **Decision:** Keep your existing esbuild scripts. The conversation mentioned Vite for single-file output; esbuild already produces one bundle with no chunks unless you ask for splitting, and it's already installed.
- **Tradeoff:** esbuild **does not type-check**. It strips types and bundles. Type errors only show up with `npm run check`. Run it before you call anything done.

### D13. Fast track to user testing
- **Decision:** Get a clickable, seeded app in front of people quickly, to test the *design and business logic*: does the one-tap "keep" work, do people make collections, do they annotate? The technical gates come after that. The contract is kept **minimal but real**: ops, merge, and views in `core/`, because the UI is built on it and redoing it later costs more than doing it thin now.
- **Shortcuts allowed for the test build:**
  - A `LocalStorageStorage` adapter instead of IndexedDB. It's small, synchronous, and fine for a demo.
  - Seed data loaded from a JSON fixture, so the feed looks alive (the workshop rule "seed it before people arrive").
  - Hosting the static `index.html` + `dist/` on a free HTTPS static host (GitHub Pages, Netlify, Vercel). Phones get real HTTPS with no Gate-three work.
- **Tradeoff:**
  - The test build is **single-device**. Each tester sees only their own ops plus the seed, with no sync, until Gate two.
  - Test only with **non-sensitive seed material**, since a public host is not the node and has no access control.
  - The shortcuts are adapters, so they're swapped out, not rewritten.
- **Deferred, not dropped:** exhaustive merge property tests, the bundle format, hashing, and the service worker.

### Open decisions (yours to make in Gate one)

**Needed now:** O1, O4, O5, O7. **Can wait until after user testing:** O2, O3, O6, O8.


These are listed in TODO.md, where they come up. Record your choice here once made.

- [ ] **O1.** Does `add-to-collection` carry one `documentId` or an array? *(Your scaffold's `addToCollection(documentIds: string[])` takes several.)*
- [ ] **O2.** Should `Access` be split into two axes? `public | private` is *visibility*, but `anonymous` is *attribution*. Can an annotation be private *and* anonymous?
- [ ] **O3.** An op must have an author device ID (its `id` contains it), yet your `Annotation.user` is optional. Does "anonymous" hide the display name only, or the device too?
- [ ] **O4.** Should an op embed objects (`document: Document`, `uploader: User`) or reference them by ID? *(An op should reference by ID. Embedding copies data that can then disagree.)*
- [ ] **O5.** Should field names keep your `user` / `timestamp`, or switch to RR00's `author` / `created`? *(D5 says yours. Just be consistent across every op type.)*
- [ ] **O6.** What happens to an op with an unknown `type` from a newer app version: reject it, or keep it but don't display it?
- [ ] **O7.** What is the name of the core facade that components call, given that `Library` is already your root component? Candidates are `LibraryStore` and `OpLog`.
- [ ] **O8.** Should you upgrade Node from 20 to 24 LTS so tests run `.ts` directly (see T3)?

---

## Technical details you need to know

### T1. The op, in your vocabulary

This is a sketch using the names from D5. Final fields are yours to decide via O1–O6.

```json
{
  "id": "phone-7Q2K:14",
  "type": "annotation",
  "user": "phone-7Q2K",
  "target": "doc-0031",
  "timestamp": "2026-10-04T14:22:05Z",
  "access": "public",
  "body": "That's the corner store on Dickinson Street."
}
```

- **`id` = `deviceId:counter`.** Different devices can't collide, and one device's counter only goes up. **The counter must survive restarts.** If storage is wiped and the counter restarts at 1, the device reuses IDs with new payloads, and that is exactly the D6 conflict case. A common recovery is to pick a new device ID after a wipe.
- **`timestamp`** is ISO 8601 in UTC (`Z`). Phone clocks are wrong often enough that it's used for *display order only*, never for correctness. Sort ties are broken by `id` so every device shows the same order.
- The op types are `document`, `annotation`, `add-to-collection`, `name-collection`, and `hide`.

### T2. Pure core, injected world
Pure functions can't read the clock, generate random IDs, or hash files. So:
- **Time and the device ID are passed in** as arguments to the functions that create ops. That keeps them testable with fixed values.
- **SHA-256 hashing** (for bundle manifests) needs `crypto.subtle`, which is a platform API. The adapter computes hashes, and core only validates the `sha256-<hex>` format.

### T3. Running tests on Node 20
- `node --test` on Node 20 can't run `.ts` files. You have two options:
  - **(a)** Upgrade to Node 22.18+ or 24 LTS, which strip types natively, so `node --test` runs your `.ts` directly. *(Recommended: no extra dependencies.)*
  - **(b)** Stay on 20 and have esbuild compile the tests to `.mjs` first.
- Node's type stripping only accepts **erasable syntax**: no `enum`, no `namespace`, and no constructor parameter properties (`constructor(private db: X)`). Use string-literal unions (you already do: `Access`, `DocumentMedium`) and plain class fields. Setting `"erasableSyntaxOnly": true` in tsconfig makes the compiler enforce this. Relative imports then need a `.ts` extension, via `allowImportingTsExtensions`.

### T4. TypeScript 7
`typescript@7.0.2` is installed, which is the native (Go) compiler. It's much faster, and it's stricter about a few removed legacy options. If an option errors, check the TS 7 release notes before working around it.

### T5. esbuild + Preact JSX
esbuild reads `jsx: react-jsx` and `jsxImportSource: preact` from `tsconfig.json`, so no JSX pragma is needed. Once `index.tsx` moves, the entry point in `package.json` scripts has to move with it.

### T6. package.json notes
- `"type": "commonjs"` doesn't match your ESM `import` syntax. Bundled output doesn't care, but Node running your tests directly does. Switch to `"module"`.
- `nodemon` is a dependency but isn't used, because `esbuild --watch` covers it. It could be removed or moved to dev dependencies.
- `@preact/signals` isn't installed yet.

### T7. Signals and context, divided
- **Signals:** The op log is one signal. The feed, collections, and annotation threads are `computed` signals from it, so when a new op lands, only the views that depend on it re-render.
- **Context:** `StorageContext` (or your chosen facade from O7) provides `MemoryStorage` now and `IndexedDBStorage` in Gate four. UI code doesn't change between them.

### T8. Phone facts that shape the design
- **iOS Safari** can evict a site's storage after about 7 days without a visit. Installed home-screen apps are exempt. Also call `navigator.storage.persist()`.
- **iOS** has no background sync. Contributions queue in the outbox until the app is opened while connected.
- **iOS** has no share target, so the upload button does the work. Android installed PWAs can register as a share target.
- **Phones** won't reliably run JS in a local HTML file. The quine/TiddlyWiki export is mainly for laptops, and zero-JS HTML is the phone-friendly archive format.
- **Test with VoiceOver and TalkBack.** Use large tap targets and relative text sizes so Dynamic Type is respected.

### T9. LoRa budget
One op is about 200 bytes, which is roughly one LoRa packet, while one photo is about 3,000,000 bytes. **Only ops travel by radio; media never does.** Keep op payloads small. This is another reason to reference by ID (O4) rather than embed.

---

## Parking lot
TiddlyWiki export · zero-JS static export · Capacitor · ESP32-only node for small groups · Reticulum / Meshtastic · ActivityPub gateway (opt-in) · `Link` / `CommentBodyPosition` passage anchors (reader subproject, RR11–RR12) · solar drop-point power budget · moderation and TK labels · search/embeddings.

## Scripts (current)
| Command | Does |
|---|---|
| `npm run dev` | esbuild watch and serve at the repo root |
| `npm run build` | minified bundle → `dist/app.js` |
| `npm run check` | `tsc`, which type-checks without emitting (esbuild doesn't type-check) |
