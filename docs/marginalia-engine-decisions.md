# Marginalia engine: decisions before it comes in

**Status: put off** (2026-10-14). Nothing in OSL uses the engine yet. This file collects what was found while looking into it, so the decisions can be made later without redoing the research. Answer the questions at the end first; build after.

The engine is the one the cs-learning hub already uses: `cs-learning/marginalia-engine-integration/` holds the packages, and `INTEGRATION-FOR-AGENTS.md` there holds the rules. Its source is the private repository `klyle-11/grounds-cc`.

---

## What it is

A Rust document engine compiled to WebAssembly. It runs in a worker of its own and opens **PDF and EPUB** only. For each page (PDF) or chapter (EPUB) it gives you:

- the text, and for PDFs a box for every character;
- **anchors**: references to a span of text that still find their words after the file's text changes a little;
- search, table of contents, OCR for scanned pages.

The npm package also ships browser pieces as plain DOM classes, with no framework:

- `SelectionEngine`: your own selection. Double-tap a word, then drag two handles. It replaces the phone's own selection, which can't be controlled precisely on a touch screen.
- `OverlayLayer`: draws highlights and finds the one under a tap.
- `Recolorer` and `PAGE_THEMES`: sepia, night and black PDF pages that leave photographs alone. EPUB chapters are themed with CSS instead.

It does **not** draw pages (pdf.js does that), store anything, or provide the rest of the UI.

## What it would give OSL

- Highlights and notes pinned to a passage in a PDF or EPUB, instead of to the whole document (W-D5).
- A PDF viewer that works on iPhone. Today a PDF is an `<iframe>`, and iPhones show only its first page (TODO, "Device and network testing"). Drawing pages with pdf.js, as the engine's guide does, fixes that whether or not highlights come with it.
- Themed PDF pages, so a dark room or the big screen isn't a white glare.

## What OSL already has that fits

| OSL has | The engine needs |
|---|---|
| `hash: "sha256-<hex>"` on library and station files (`scripts/catalog.mjs`, `/api/upload`) | The file's SHA-256 as its identity. Pass the hex as `{ fingerprint }` and the engine skips hashing the whole file. |
| Range requests on the node (`sendFile`, W4), and slices of cached files in `app/sw.ts` | To read the file a piece at a time. The hub's `cs-learning/hub/js/engine-worker.js` already reads a server file into the engine by range requests; it would port almost as it is. |
| An op log that is the only record (D6) | Nothing: the engine keeps annotations in memory only. OSL's ops stay the record, and the engine is only asked where each highlight lands. |
| Preact components | Plain DOM classes: create them in a `useEffect` and destroy them in its cleanup. Preact must never render inside the page elements they manage. |

## What it costs (measured)

| Part | Raw | gzip |
|---|---|---|
| OSL's whole app today (`dist/app.js`) | 101 KB | — |
| Engine WebAssembly (`marginalia_wasm_bg.wasm`) | 2.64 MB | 1.04 MB |
| Engine WebAssembly with OCR (only if OCR is wanted, plus about 12 MB of models) | 5.81 MB | 2.01 MB |
| pdf.js 4.10.38 (`pdf.min.mjs` + `pdf.worker.min.mjs`) | 1.73 MB | 0.50 MB |
| **Engine + pdf.js, no OCR** | **about 4.4 MB** | **about 1.6 MB** |

One highlight, measured on `docs/local-first-reading-room.pdf`: the engine's anchor is **316 bytes** of JSON, and a whole engine annotation record is about **505 bytes**.

## Where it clashes with decisions already made

1. **D10, everything in one file.** The engine is a separate worker and a `.wasm` file, and the cs-learning hub loads it the first time a PDF is opened. Either D10 changes ("the app is one file; the document engine is an optional extra loaded on first use"), or the export formats (TiddlyWiki, zero-JS) go without it, which they would anyway.
2. **The drop point can't carry it.** The drop point serves the app from its flash file system (LittleFS). That partition is **1.5 MB** on the 8 MB boards (`default_8MB.csv`: Heltec V3, XIAO) and **896 KB** on the LilyGO (`huge_app.csv`). Even compressed, engine and pdf.js are about 1.6 MB, and the op queue lives in the same space. So either a drop point serves the app without the engine (and PDFs open plainly there), or phones only get the engine from the Pi.
3. **Op ids.** OSL ids are `device:counter` (`phone-7Q2K:14`). The engine accepts only `[A-Za-z0-9_-]{1,128}`, so the colon is refused. A fixed, reversible conversion is needed when OSL's notes are handed to the engine. Never store the converted id.
4. **Radio (T9).** T9 budgets about 200 bytes per op. A note carrying the engine's anchor is about 400–500 bytes. `osl_link` already splits messages into fragments of up to 4,800 bytes, so it works, but each such note costs about 3 radio packets instead of 1. The anchor holds optional `rects`; leaving them out would make it smaller, but the rules say an anchor must be stored exactly as the engine returned it. Ask the engine's author before trimming.
5. **The engine's annotation model is not OSL's.** The engine edits records in place (last writer wins on `updated`, `deleted: true` as a tombstone). OSL never edits: corrections are new ops and "hide" is its own op (D6). Keep OSL's model and translate when importing into the engine. Each annotation op becomes one engine record, with `created` = `updated` = its timestamp in milliseconds, and hidden ones are left out.
6. **Highlight colours and kinds.** The engine needs a `color` (`#rrggbb`) and a `kind` (highlight, underline, strikeout, note). OSL has no highlight types yet. cs-learning's `hub.json` has a list of types to start from ("Unclear", "Question", …).
7. **Plain http.** On plain `http://` (no domain yet), phones have no `crypto.subtle`, so a file a phone adds gets an `fnv1a-` hash, not SHA-256. The engine would then hash the file itself. Library and station files are hashed on the node and are fine.
8. **Licence.** The package says `"license": "UNLICENSED"` and its source is private. The built files are already public in cs-learning, but bundling them into a public community library is a choice to make on purpose: decide the engine's licence first.

## Markdown and plain text

The engine does not open Markdown or text, and the cs-learning hub doesn't use it for them either. OSL's sample documents are `.txt` poems. For those:

- **Selection:** `SelectionEngine` accepts any viewer that implements its `Surface` interface (`hit`, `text`, `rects`, `host`). Render the text into a shadow root shaped like an EPUB chapter and pass it to `epubSurface`; `offsetOf` and `rangeFor` in `marginalia-engine/dom` work on any root. The gestures and handles are then the same as on a PDF.
- **Anchor:** OSL needs its own, pure, in `core/`. The hub's anchor is the one to port: the block (a 16-digit hash of its letters and digits), which occurrence of that block, how far in, and 24 characters either side (`cs-learning/server-cpp/src/anchor.hpp` explains the folding and hashing; `cs-learning/hub/app.js`, "anchors", builds it). It is about 110 bytes of JSON, a third of the engine's anchor (a note with it is about 2 radio packets rather than 3), and it needs no engine at all.

That means text and Markdown highlights could come before the engine, with the same look, and with nothing large to load.

## Where it could live

| Option | For | Against |
|---|---|---|
| A. The `.tgz` copied into this repo (`vendor/`), `"marginalia-engine": "file:vendor/…"` | Builds anywhere, offline, on the Pi | 3.4 MB binary in git per version; licence question (8) |
| B. Installed from `../cs-learning/marginalia-engine-integration/` | No copy | Breaks for anyone who clones OSL alone |
| C. Not in the repo; the node fetches it once at install from a release | Repo stays small | Needs the internet at install, and a release to fetch from |

Whichever it is: the node serves it under one path (like the hub's `/vendor/marginalia/`), the service worker keeps it once fetched, and the app imports it only when a PDF or EPUB opens.

## Questions to decide (M1–M8)

- [ ] **M1. Formats, and in what order?** PDF only, PDF and EPUB, or text and Markdown first (no engine needed, see above)?
- [ ] **M2. D10:** may the engine and pdf.js load on first use, outside the one-file app?
- [ ] **M3. Drop points:** serve the app without the engine, or no PDF reading at drop points?
- [ ] **M4. Where it lives:** A, B or C above?
- [ ] **M5. Licence** of the engine, before it ships in a public repo.
- [ ] **M6. Op shape:** a new op type (`highlight`) or an optional `anchor` on `annotation`? What does an old app version do with it (O6)?
- [ ] **M7. Radio:** accept about 3 packets per passage note, or send passage notes by radio without the anchor (the node fills it in)?
- [ ] **M8. Who writes it:** part of the demo on this branch, or a W12 module in `workshop-write-it-yourself.md`?

## When to come back to it

After the device tests in TODO.md. Their results say whether people use PDFs enough to justify 1.6 MB, and whether the plain viewer is the real problem on iPhone. Fixing the iPhone PDF problem with pdf.js alone (0.5 MB compressed, no engine) is a smaller step that can be taken on its own.
