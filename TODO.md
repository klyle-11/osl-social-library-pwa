# TODO: workshop branch

This section is for the `workshop` branch. The original fast-track list is kept below as background.

## Tonight: radio bench test

Two boards, both with the **modem** build, both plugged into this computer. No phones or app involved; this proves boards, pins, antennas and settings.

- [ ] Attach the antenna to every board **before** powering it.
- [ ] Add PlatformIO to your shell: `export PATH="$HOME/.platformio/penv/bin:$PATH"`.
- [ ] Flash the LilyGO: `cd firmware && pio run -e modem-lilygo-t3s3 -t upload`.
- [ ] Flash a XIAO: `pio run -e modem-xiao-s3 -t upload`.
- [ ] Find the two ports: `ls /dev/cu.usbmodem*`.
- [ ] Run `node scripts/radio-test.mjs <port A> <port B>` from the repo root.
- [ ] If a board reports the radio did not start, the pins for that board are wrong; note the error number.
- [ ] Repeat with one board in another room. Write down delivered count, time each, RSSI and SNR.

If a XIAO will not enter upload mode, hold its BOOT button while plugging it in.

**Done when:** the test prints PASS both ways for LilyGO to XIAO and for XIAO to XIAO, and the numbers are in your log.

## Device and network testing (the demo)

- [ ] Give the Pi a fixed address on the router (a DHCP reservation). The address is the app's origin: if it changes, every phone opens an empty app (W-D10).

- [ ] `npm run rehearse` passes (28 checks, headless; on the Pi set `CHROME=/usr/bin/chromium`). It covers the notes, presence, presenter, offline, pause, node-restart, clean-start and ten-devices items below without real devices; do them for real anyway, since what it can't see is Safari, Wi-Fi and people.
- [ ] `npm start`; open the big screen on the laptop or Pi.
- [ ] iPhone (Safari) and Android (Chrome) on the same Wi-Fi: open the address, read, post a note.
- [ ] A note from each phone appears on the other and on the big screen within three seconds.
- [ ] "Rosa is also viewing this document" appears and disappears correctly.
- [ ] Pair a presenter; "Show on the screen"; "Follow the screen" moves the phones.
- [ ] Play and **seek** the sample film and sample recording on both phones.
- [ ] Open the sample PDF on both phones (iPhone shows only the first page inline; use "Open full screen").
- [ ] Pair a laptop as the digitization station and upload a real scan, a real audio file and a real video.
- [ ] Turn the phone's Wi-Fi off, post a note, turn it on: the Sync screen shows it waiting, then sent.
- [ ] Stop the node for a minute while phones are open; start it; nothing is lost or doubled.
- [ ] Ten or more devices at once: does the node keep up?
- [ ] VoiceOver and TalkBack: open a document and post a note.
- [ ] On the Pi 5: `npm install`, `npm start`, and repeat the first six checks.
- [ ] Write down every place someone hesitated. That is the UX result.

## Libraries, accounts, roles (W-D12)

Design: [docs/libraries-and-accounts.md](docs/libraries-and-accounts.md). Rehearsed with `npm run rehearse:people`.

- [x] Several libraries on one node, each with its own log and storage on the phone; `main` is the one that was there.
- [x] Password protection, set when a library is made or later; changing it closes it again everywhere.
- [x] Optional accounts, one per node; guests' names show with "(Guest)"; the first account needs the pairing code and looks after the node.
- [x] Roles per library (admin, steward, presenter, digitizer, uploader, member) and groups.
- [x] Who may add documents, as any combination; checked at the library, the radio included.
- [x] A watch folder per library on the node.
- [x] Collections: who may see and who may add, for everyone, only the owner, or chosen people and groups; the node sends a restricted collection only to the people it's for.
- [ ] Make the first account on the Pi with the code on its screen, before the workshop: whoever does it looks after the node.
- [ ] Decide whether `main` should be protected for the workshop (You → Libraries → Manage).
- [x] Drop points carry the libraries the node admin chooses, protected ones too, and ask for the password there (rehearsed in `rehearse:radio`).
- [ ] Flash the modem and the drop point from this version (the radio messages have two new kinds), and try a protected library at the drop point on a real phone.
- [ ] Signed ops, so the radio can't be used to write as an account (W-D12, "Known gap").
- [ ] On real phones: sign in on two phones, Keep on one, see it on the other; a protected library's lock screen on Safari.

## Blocked on the domain (Gate three)

- [ ] Rent the domain.
- [ ] Certificate by DNS challenge; files into `certs/`.
- [ ] The Pi's own Wi-Fi and local name lookup.
- [ ] iPhone and Android: padlock with no warning, internet unplugged.
- [ ] Install to the home screen; airplane mode; reopen; write; reconnect; sync.
- [ ] Decide the renewal routine (reuse the key, so only the certificate has to travel).
- [ ] Start the node on boot.

## After that

- [x] Port the drop point firmware to this branch's op format and `/api/ops` (rehearsed on a computer: `npm run rehearse:radio`).
- [ ] Build the drop point for a board (`pio run -e droppoint-xiao-s3`) and fix what the compiler finds in `src/droppoint/`.
- [ ] Set `LIBRARY_ADDRESS` and `LIBRARY_PORT` in `firmware/include/config.h` to the Pi's fixed address, and `DROP_NAME`; flash a drop point; walk a phone out to it.
- [x] The library lists its drop points: connected or not heard since, signal both ways, app version (Sync → Drop points).
- [ ] Range test for the first drop point, a mile out: `STATUS_INTERVAL_S 30`, antennas high, read the signal on the Drop points page; steps in `firmware/README.md`, "Range". Write down where each antenna was and what the page said.
- [x] Pi-side radio bridge in `node/` (`node/radio.ts`, `RADIO_PORT`).
- [ ] Addresses and relaying, so more than two boards can share the air.
- [x] Sync screen: the drop-point stop becomes real.
- [ ] Omeka export of documents with their notes as private items (which Omeka?).
- [ ] `kiwix-serve` beside the library for ZIM archives.
- [ ] NFC tag for first pickup; redeem roles inside the installed app.
- [ ] Marginalia engine for passage anchors: **put off**. Questions M1–M8 and what was measured are in [docs/marginalia-engine-decisions.md](docs/marginalia-engine-decisions.md).
- [ ] TiddlyWiki export as the takeaway file.
- [ ] Rewrite it yourself: [docs/workshop-write-it-yourself.md](docs/workshop-write-it-yourself.md).

---

# Background: the original fast-track list

## Fast track to user testing

The goal is **a seeded, clickable OSL on real phones, tested for the design and business logic.** Do people keep documents, make collections, name them, and annotate? After that, return to the gates. See README **D13** for what's cut and why.

**Rules:**
- You write all the code. Ask Claude for *an explanation or the next hint*, not a solution.
- Every "Done when" has to be seen working, not assumed.
- Record decisions in README → Decisions log / Open decisions.

**Start of session (2 min):**
- Which step am I on?
- What's its "Done when"?
- What's the one thing I'll make observably true today?
- What goes in the parking lot?

**End of session (1 line), for example:**
`2026-09-29 · FT1 · merge passes order + duplicate tests · next: views · parked: graph view`

---

## FT0: Housekeeping · Small · one 25-min box

**Trap:** carrying small bugs into the shell and debugging them as if they were "Preact problems".

- [ ] `index.html`: fix `src=""dist/app.js"` (stray quote).
- [ ] `index.html`: it links `style.css`, but the file is `styles.css`.
- [ ] `index.tsx`: the `// Site header`-style lines inside JSX render as visible text. Use JSX comments, or move them outside the JSX.
- [ ] `tsconfig.json`: fix the typo `skipLibChceck`.
- [ ] `data.json` isn't valid JSON. Decide whether it becomes `core/fixtures/seed.json` (FT3) or gets deleted.
- [ ] Restructure (D3): `core/`, `adapters/`, `app/`. `index.tsx` → `app/`, `types.d.ts` → `core/types.ts` (a `.ts` module, not `.d.ts`, since it now holds real exports).
- [ ] Rename `Document` → `LibraryDocument` (D5).
- [ ] `core/tsconfig.json` without the DOM lib, plus a script that type-checks core alone.
- [ ] Update the esbuild entry path in `package.json` scripts.
- [ ] `npm i @preact/signals`. Set `"type": "module"` (T6).
- [ ] Add `.DS_Store`, `node_modules/`, and `dist/` to `.gitignore`.
- [ ] Decide O8: upgrade to Node 24, or compile tests with esbuild (T3).

**Done when:**
- `npm run dev` serves a page showing your header with no stray text.
- `npm run check` passes.
- Putting `document.title` in any `core/` file makes the core check **fail**. Try it, then remove it.

<details><summary>Hint ladder</summary>

1. The core-only check is just `tsc -p core`. What does `lib` default to when you don't set it?
2. A child tsconfig can `extends` the root one and override only `lib` and `include`.
3. If core still sees DOM types, look at whether the root `include` is pulling `app/` files into the same program.
</details>

---

## FT1: The thin contract · Medium · 2–3 boxes

**Story:** Two phones keep documents and annotate them while offline. When their notes meet, nothing is lost and nothing is doubled.

**Trap:** letting the components invent the op shape. It gets settled *here*, before any screen touches it.

**Decide first** (write your answers in the README):
- O1: does `add-to-collection` carry one ID or many?
- O4: embed or reference by ID?
- O5: field names.
- O7: the name of the core facade.

**Feature** (all in `core/`, pure, no DOM, no clock, no randomness; see T2):
- [ ] Op types for `document`, `annotation`, `add-to-collection`, `name-collection`, and `hide`, using your vocabulary.
- [ ] **Create** functions that take the device ID, counter, and time as inputs and return an op.
- [ ] **Validate**: an unknown type or missing fields → rejected, with a reason you can show.
- [ ] **Merge**: union by `id`. The same `id` with a different payload → a reported conflict, never a silent overwrite (D6).
- [ ] **Views:**
  - the *feed* (documents plus their activity, ordered by `timestamp` with ties broken by `id`)
  - *collections* (the documents in each collection, plus a name decided by last-writer-wins with the owner-only rule)
  - the *annotation thread* for each document
  - all of the above with hidden items excluded
- [ ] Three tiny fixtures: phone A, phone B, and an overlap (a shared op).

**Fence:** no storage, no network, no UI, no bundle, no hashing. Those are deferred (D13).

**Done when:**
- merge(A,B) equals merge(B,A);
- merge(merge(A,B), A) equals merge(A,B);
- a conflicting duplicate is reported;
- renaming a collection twice shows the later name, and a rename by a non-owner is ignored.

**Prove it:** Fill in the blank: "Arrival order can't change what the feed shows because ___."

<details><summary>Hint ladder</summary>

1. Tell apart "same ID" and "same object". What should happen in each case?
2. Views are a single pass over the op log that builds up plain data. Write the expected output for your fixture on paper first.
3. If order still changes the result, find the *first* pair of ops for which swapping them changes the answer, and debug only that pair.
</details>

---

## FT2: The shell · Medium · 2–3 boxes

**Story:** Someone opens the page and immediately sees a library, not a blank form.

**Trap:** building ops inside components. Components call the facade; they never assemble an op (D4).

**Feature:**
- [ ] `adapters/`: a `MemoryStorage` that implements your core `StorageAdapter` interface (put op, list ops).
- [ ] `app/` state: one op-log signal, and `computed` signals for the views from FT1 (T7).
- [ ] A context that provides the facade and its adapter to the tree.
- [ ] Your components, with your names:
  - `Library` (root and provider)
  - `Header`
  - a feed/grid of documents
  - `Collection`
  - `SingleDocumentView` (metadata, the annotation thread, and an annotation form)
- [ ] **Keep**: one tap adds a document to a collection. This is the "first action costs one tap" rule.
- [ ] Naming a collection: replace `prompt()` with an inline field. `prompt()` is jarring on phones and hard for screen readers.
- [ ] A clear "you're caught up" end to the feed, with no infinite scroll.

**Fence:** no routing library yet (state-driven view switching is enough), no styling polish beyond readable, no IndexedDB.

**Done when:** Keep, annotate, and name each update every view that shows them, with no manual refresh. `npm run check` passes.

<details><summary>Hint ladder</summary>

1. If a view doesn't update, check whether you *replaced* the op-log signal's value or mutated the array it holds.
2. The facade's "add" method does three things in order: create, validate, then store and update the signal. Which one did you skip?
3. Context is for *which implementation* is in use; signals are for *what changed*. Are you putting state in context?
</details>

---

## FT3: Seeded and survives a refresh · Small · one box

**Story:** The feed already looks alive when the first person arrives, and their work is still there when they come back.

**Feature:**
- [ ] `core/fixtures/seed.json`:
  - 10–20 real, **non-sensitive** documents
  - a few annotations
  - one or two starter collections

  Write them as ops from a "steward" device.
- [ ] Load the seed at startup by merging it in, so it can't duplicate. That doubles as a live test of FT1's idempotence.
- [ ] A `LocalStorageStorage` adapter, swapped in through context. **No component changes allowed.** Wrap reads and writes in try/catch; private browsing can throw.
- [ ] A device ID generated once and kept. A counter that survives refreshes (T1).
- [ ] An optional display name (the "name it if you want" rule).

**Done when:** You add an annotation, refresh, and it's still there. The seed isn't doubled. Swapping adapters touched only the provider line.

---

## FT4: User test and presentation · Medium

**Story:** Real people, with no instructions beyond a prompt, on their own phones.

**Setup:**
- [ ] Deploy `index.html` + `dist/` + `styles.css` to a free HTTPS static host (D13).
- [ ] Put a QR code on a card or slide.
- [ ] Test the full flow on one iPhone and one Android phone yourself first.
- [ ] Do a readability pass:
  - large tap targets
  - relative font sizes
  - alt text on seed images
  - one VoiceOver pass

**Test script** (give prompts, not assignments):
- "Find something that reminds you of home and keep it."
- "Make a collection for someone you'd share it with. Name it if you want."
- "Leave a note on one thing you know something about."

**Observe and write down** (this is the design and business logic you're testing):
- [ ] Did they find **Keep** without help? How long did it take?
- [ ] Did anyone make a collection unprompted? Name it? Annotate?
- [ ] Where did they hesitate, or ask "what does this do"?
- [ ] Did "you're caught up" feel like an end or a bug?
- [ ] Would they add it to their home screen? What stopped them?
- [ ] Which word confused them: document, collection, annotation, keep?

**Presentation kinks:**
- [ ] A 60-second story:
  - the problem (profit-driven feeds)
  - the ladder: visitor → contributor → keeper
  - "what you collect is what you carry"
- [ ] A backup plan if the venue Wi-Fi fails: a local `npm run dev` on a laptop hotspot, plus screenshots.
- [ ] Be honest about what's not built yet: sync, offline install, radio. Point to the gates.

**Done when:** At least three people have used it unaided, your notes are written, and each finding is tagged *design* / *wording* / *tech*.

---

## After the test: back on the route

- [ ] Feed the findings into the contract (did the op types hold up?) and record the changes in the Decisions log.
- [ ] **Gate one, full:**
  - property tests across many orderings and groupings
  - the bundle format (ops + manifest)
  - hashing in the adapter (T2)
  - O2, O3, O6
- [ ] **Gate two:** the node, sync endpoint, and `node/` folder, importing the same `core/`.
- [ ] **Gate three:** HTTPS on the node with no internet.
- [ ] **Gate four:** IndexedDB adapter, service worker, manifest, "Save my collection" export.
- [ ] Gates five through seven, per RR00.

## Parking lot
Graph view (from your scaffold's comments) · grid vs. list toggle · everything in the README parking lot.
