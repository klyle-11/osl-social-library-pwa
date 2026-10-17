# OSL — Offline Social Library

*Developed for Maroon's Motherboard project.*

---

# This branch: `workshop`

A running demo of the workshop version: one screen presents a document, and everyone in the room annotates it from their own phone or laptop. It exists for UX testing on real devices and for network testing. Everything below the next rule is the project background and still applies.

| | |
|---|---|
| **Who wrote this code** | Claude, at your request, as a demo. You rewrite it yourself with [docs/workshop-write-it-yourself.md](docs/workshop-write-it-yourself.md) (no solution code in it). |
| **Built on** | The `fastroute` demo (core contract, node, Preact shell), extended for the workshop. `firmware/` comes from `esp32-lora`. |
| **Where it stops** | At Gate three. Offline install on phones needs HTTPS, which needs the domain. |
| **Committed** | Pushed to `origin/workshop`. |

## What works now

| Feature | State |
|---|---|
| Gallery front page, shared header with search and kind filter | Works |
| Gallery sorting (newest/oldest added, title, author by surname, who added it; each both ways, remembered per device), format filter, search by every word across details, uploader, format, collections and notes | Works in a test browser |
| Gallery thumbnails: a PDF's first page, an EPUB's cover, a video frame, a scan made small; made by the device that adds it, or the first time it's opened at the library | Works in a test browser |
| Everyone's collections, as soon as they're named; each document lists the collections it's in | Works in a test browser |
| Drop points page on the Pi (Sync → Drop points): the library's radio, and every drop point heard, connected or not heard since, with signal both ways | Rehearsed (`npm run rehearse:radio`); needs the boards |
| Themes: Paper (`#fffffc`, the default), Selenized light, dark and black, and Maroon; chosen per device on You → Appearance | Works |
| Reader: document on the left; details, presence and notes on the right (stacked on phones) | Works |
| Whole-item notes, appearing on other devices within about two seconds | Works |
| Details (metadata) filled in or corrected, latest wins per field. The uploader chooses who may, any time: everyone (the default), only them, or people they pick; stewards always may. Enforced on every device; edits made before a change stand | Works in a test browser |
| Line breaks in descriptions and notes show as written | Works in a test browser |
| Presence: "3 online", "Rosa is also viewing this document" | Works |
| Big screen (`#/present`): document, join QR code, who is here, notes as they arrive | Works |
| Pairing code for a presenter and for one digitization station | Works |
| Anyone uploads any file from Add, no pairing: streamed to the library whole and hashed, up to 2 GB (`OSL_MAX_UPLOAD`). Phone photos are still shrunk and kept on the phone until they sync, so they work at a drop point; the paired station's photos go up at full size | Works in a test browser |
| Uploaded files can't run as pages on the library's address: served sandboxed, and anything but images, audio, video, PDF, EPUB and plain text downloads instead of opening | Works in a test browser |
| PDF reader (pdf.js 6.3, loaded only when a PDF is opened): pages drawn as you scroll, go to page, zoom, full screen, back where you left off | Works in a test browser; check on real phones |
| EPUB reader (no library): chapters, contents, in-book links, text size, the app's theme, back where you left off; scripts never run; DRM books refused with a message | Works in a test browser; check on real phones |
| The phone's own text selection (press and hold, drag, copy) in PDFs (pdf.js's text layer over each page; a scan without text has none), EPUBs and text files, and in notes, who wrote them and a document's details; buttons, menus and the rest of the app can't be selected | Works in a test browser; check on real phones |
| Audio and video playback with seeking (Range requests) | Works in a test browser; check on real phones |
| Sync screen: waiting to send, pause, sync now | Works |
| Storage in IndexedDB; save and load your work as a file | Works |
| Offline install and offline reopening on phones | **Needs the domain** (works on `localhost` only) |
| Radio link and drop point | Rehearsed on a computer (`npm run rehearse:radio`); drop point not yet built for the boards (see below) |
| Several libraries on one node, each with its own notes, collections and storage on the phone; picked in the header (`?library=` in the address) | Rehearsed (`npm run rehearse:people`) |
| Password protection for a library, at creation or later; a lock screen until it's entered; a new password closes it again everywhere | Rehearsed |
| Optional accounts (one per node; scrypt), guests named with "(Guest)"; signing in links the device, so an account's devices share Kept and collections | Rehearsed |
| Roles per library (admin, steward, presenter, digitizer, uploader, member) and groups, on the Manage page; the node admin manages accounts | Rehearsed |
| Who may add documents, any combination (anyone, signed in, members, uploaders, digitizers, presenters); enforced at the library | Rehearsed |
| A watch folder per library: files put in it on the node become documents | Tried with `curl` and a scratch folder |
| Collections: who may see (everyone, only me, people and groups) and who may add; private ones never leave the library for anyone else | Rehearsed |
| Moderation: everything newest first with device and address; strike out (stays, words ***) or remove, erased from the library's log and from phones; removed uploads' files deleted; bans by device, address or account with a message and the admin's contact; people delete their own things; a Takedown page with DMCA information and a request form ([docs/moderation.md](docs/moderation.md)) | Rehearsed (`npm run rehearse:people`) |
| Each person's Kept is private to them and the library's admins until they share it | Rehearsed |
| Drop points carry other libraries the node admin chooses, protected ones too: the password is asked at the drop point, checked against the PBKDF2 hash the library sends by radio | Rehearsed (`npm run rehearse:radio`); not yet on a board |
| Marginalia engine, Omeka export, Kiwix/ZIM, NFC, TiddlyWiki export | Not built |

Checked with 98 unit tests (core and node), the firmware's tests, `curl` against every endpoint, and `npm run rehearse`: 29 checks with two phones, a presenter laptop and the big screen in headless Chrome, including the node stopping, a clean start, a power cut mid-write and 30 extra devices; `npm run rehearse:radio` (31 checks, with a protected library at the drop point) and `npm run rehearse:people` (36 checks: libraries, passwords, accounts, roles, private and shared collections, moderation, bans, takedowns). It has **not** been run on a real phone or on the Pi yet.

## Run it

```
npm install
npm start            # builds, then runs the node on port 8080
```

The node prints its addresses and a **pairing code**:

- **This computer:** `http://localhost:8080`
- **Phones on the same Wi-Fi:** `http://<this computer's address>:8080`
- **Big screen:** `http://localhost:8080/#/present`

| Command | Does |
|---|---|
| `npm start` | Build, then run the node |
| `npm run dev` | Rebuild and reload on every save |
| `npm run check` | Type-check app, core and service worker |
| `npm test` | Core tests |
| `npm run rehearse` | Rehearse the device tests in headless Chrome against a scratch node (about three minutes; leaves `data/` alone) |
| `npm run rehearse:radio` | Rehearse gate seven: the library, a drop point and the radio, from the firmware's own code (Linux, macOS) |
| `npm run rehearse:people` | Rehearse libraries, accounts, roles and private collections: two laptops, a phone and a guest |
| `OSL_NAME="Maroon library" npm start` | Name the main library (only when it's first made) |
| `npm run test:firmware` | The firmware's tests, on this computer |
| `npm run build:firmware` | Build, then put the app into `firmware/data/` for a drop point |
| `RADIO_PORT=/dev/ttyACM0 npm start` | Run the node with the LoRa modem plugged in |
| `npm run catalog` | Rebuild the catalog after adding files to `library/files/` |
| `PORT=9000 npm start` | Use another port |
| `OSL_CODE=123456 npm start` | Fix the pairing code instead of a random one |

**To present:** on the facilitator's device open You → Pair this device, enter the code, choose Presenter. Open a document and choose "Show on the screen". Open `#/present` on whatever is plugged into the projector.

**To upload:** anyone uses Add, on the library's Wi-Fi (a drop point takes photos only). Pairing as Digitization station only changes photos: they go up at full size instead of shrunk. Only one station is paired at a time; pairing another replaces it.

**To add documents by hand:** drop files in `library/files/`, run `npm run catalog`, and edit the new entries in `library/documents.json`.

**Accounts and libraries:** the first account (You → Account) looks after the node; making it needs the pairing code. It makes libraries (header → the library's name → Libraries) and hands out roles (Manage). Details: [docs/libraries-and-accounts.md](docs/libraries-and-accounts.md).

**Data:** contributions are in `data/ops.jsonl` and uploads in `data/media/`. Other libraries' logs are in `data/libraries/<id>/`; libraries' settings in `data/libraries.json`, accounts in `data/accounts.json` and browsers' sessions in `data/sessions.json` (keep those three private: they're written readable by the node's user only). Delete `data/` to start clean; phones that were open catch up from the new log by themselves (the cursor carries the log's id, in `data/log-id`; if you copy `data/` to start a second node, delete `log-id` in the copy). A last line cut off by a power cut is skipped and left in the file, and the node still starts.

## On the Raspberry Pi

It runs on ARM as it is: the node uses only Node's built-in modules.

1. Use 64-bit Raspberry Pi OS and Node 20 or newer (`node -v`).
2. Clone the repo on the Pi and run `npm install` **there**. Do not copy `node_modules` from the Mac; the build tools in it are per-platform.
3. `npm start`, then open `http://localhost:8080/#/present` in the Pi's browser for the HDMI screen.
4. **Give it the name `osl.local`** (once). Phones then join at `http://osl.local`, no numbers or port. The Pi announces its own name on the network, so renaming it is enough; port 80 lets the address leave out `:8080`:
   ```sh
   sudo hostnamectl set-hostname osl
   sudo sed -i 's/^127\.0\.1\.1.*/127.0.1.1\tosl/' /etc/hosts
   echo 'net.ipv4.ip_unprivileged_port_start=80' | sudo tee /etc/sysctl.d/90-osl-port80.conf
   sudo sysctl --system
   ```
   then start the node with `PORT=80 npm start`. It prints `http://osl.local` first, and the big screen's join code shows it. iPhones, Macs, Windows and Android 12 or newer find `.local` names; an older Android needs the number it prints below. Phones keep their data per address, so pick the address before people start using it. A drop point answers `osl.local` too (`LIBRARY_NAME`, `LIBRARY_PORT` 80 in `firmware/include/config.h`).

Not done yet for the Pi: starting on boot, and the Pi's own Wi-Fi network. Both belong to Gate three.

## Where the domain comes in

Nothing in the list above needs it. You need the domain for the next step only:

1. Rent the domain.
2. Get a Let's Encrypt certificate for it with a DNS challenge.
3. Put the files at `certs/cert.pem` (the full chain) and `certs/key.pem`; the node switches to HTTPS when both exist.
4. Make the Pi's Wi-Fi answer that name with the Pi's address.

After that phones can install the app and reopen it offline. Until then they can use it live on the Wi-Fi, and `localhost` on a laptop shows the offline behaviour.

## Radio and drop points

- `firmware/` builds the **modem** for the LilyGO T3-S3, the XIAO ESP32S3 + Wio-SX1262 kit and the Heltec V3. Boards of different makes can talk to each other.
- **Ready for the bench:** two modems and `scripts/radio-test.mjs`. Fixed in 0cd8cee: the modem was sending every op without its kind byte, so the other board dropped it; the bench test would have shown 0 arrived.
- **Drop point, ported to this branch:** it serves the app and the library's own `/api/ops` at the library's address (W-D10), keeps phones' notes in flash, and sends them to the Pi by radio; the Pi sends its notes back out. A phone's Sync screen shows notes "on the way by radio" until they come back from the library. The Pi's side is `node/radio.ts`, started with `RADIO_PORT`.
- **Tested on a computer, not on boards:** `npm run rehearse:radio` runs the drop point's and the modem's code with a pretend radio, and walks phones in headless Chrome from the library to the drop point and back, and opens a protected library at the drop point (31 checks). The drop point's board layer (`web.cpp`, `main.cpp`) has not been through the ESP32 compiler since the port: this session couldn't download it. See `firmware/README.md`.
- **Drop points page:** each drop point says it's there every two minutes by radio, and the Pi lists it (Sync → Drop points): connected or not heard since, signal both ways, notes waiting, app version. The modem passes these on, so flash the modem from this version.
- **Not ready:** more than one drop point. Frames carry no addresses yet; that is the relay work.

## Decisions on this branch

- **W-D1. PWA with a Let's Encrypt certificate.** Renewal is the one thing that needs the internet. If the certificate lapses, the app still opens and saves locally, and "Save my work" carries contributions by file.
- **W-D2. Polling, no WebSocket.** Every open device asks for news every two seconds. The same endpoint can later run on an ESP32 drop point.
- **W-D3. Presence is not an op.** It lives in the node's memory and is forgotten ten seconds after a device stops asking. It is never stored or sent by radio.
- **W-D4. No live cursors.** One screen presents; others annotate. Presence is "who is online" and "who is viewing this".
- **W-D5. Whole-item notes first.** The marginalia engine (passage anchors) comes later.
- **W-D6. Details are ops.** A `describe` op per field, latest wins, the original document op never changes.
- **W-D7. Roles come from a pairing code** on the node's own screen. Several presenters, one digitization station.
- **W-D8. Custom LoRa firmware, ops only.** The Pi is the only home node; drop points are ESP32-only; secondary drop points will relay through the main one. Not compatible with Meshtastic. *Reaffirmed 2026-10-16:* the first deployment is the Pi and one drop point about a mile away, which our own link covers. Reticulum (with LXMF propagation nodes) was considered for several drop points; it would make each drop point a small Linux computer with an RNode, so it is in the parking lot until there are more drop points, or until microReticulum runs on an ESP32 alone.
- **W-D9. Sync is managed inside the app** (the Sync screen), not a separate app.
- **W-D11. Paper is the default look.** An archive's page: `#fffffc` and ink, hairline rules, one plain sans-serif, small capitals for section labels (after Monoskop), with Selenized's colours. Selenized light, dark and black and the first Maroon colours are on You → Appearance, kept per device, so the big screen can be dark while phones stay on paper. Every theme's text colours pass 4.5:1.
- **W-D12. Libraries, accounts and roles.** A node holds several libraries, each with its own log; files are held once and handed to whoever may open a library that has them. Accounts are optional and per node; ops keep their device ids, and the node publishes which device is whose account, so the merge and the drop point don't change. Roles are per library. A protected library's password is PBKDF2 so a drop point can check it; accounts are scrypt. A collection that isn't for everyone is sent only to the people it's for, and not by radio. Over the radio the library takes a drop point's word for who wrote an op (a known gap). In full: [docs/libraries-and-accounts.md](docs/libraries-and-accounts.md).
- **W-D10. People get the app at the Pi; drop points are for syncing.** The Pi has the library, the files, pairing and the big screen; a drop point is a write-only inbox with 1.5 MB of flash. Both answer at the **same address** (phones keep their data per address), and a drop point always carries the **exact build the Pi serves**: a phone moving between two different builds would switch app versions each time. Before the domain, that address is the Pi's fixed IP and port over plain http, which a drop point can take on its own Wi-Fi network; after it, the domain over HTTPS.
- **Hardware:** Raspberry Pi 5; one LilyGO T3-S3 v1.3 (SX1262); three Seeed XIAO ESP32S3 with Wio-SX1262; all 915 MHz.

**Open:** which domain; Omeka S or Classic; what else the Sync screen should control; whether a Waveshare board joins (needs its model to add pins); the marginalia engine, put off, questions M1–M8 in [docs/marginalia-engine-decisions.md](docs/marginalia-engine-decisions.md).

---

# Background: the whole project


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
TiddlyWiki export · zero-JS static export · Capacitor · ESP32-only node for small groups · Reticulum + LXMF for more than one drop point (or microReticulum on ESP32, when ready) · Meshtastic · ActivityPub gateway (opt-in) · `Link` / `CommentBodyPosition` passage anchors (reader subproject, RR11–RR12) · solar drop-point power budget · moderation and TK labels · search/embeddings.

## Scripts
See "Run it" at the top of this file for the scripts on this branch.
