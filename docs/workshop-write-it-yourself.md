# Workshop branch: write it yourself

The demo on this branch was written for you so there was something to put in front of people. This guide is for writing it again yourself. It has no solution code. Each module gives you the idea, the trap, the questions to answer before you type, what the result must do, and how to prove it.

## How to use this

1. **Work on a fresh branch from `main`**, not on `workshop`. Keep `workshop` as the reference you compare against at the end of each module.
2. **Do the modules in order.** W1 to W3 are the spine; everything after hangs off them.
3. **Write your design first.** For each module, write down at least two ways to do it and which you chose, before any code. Put it in the README decisions log.
4. **Peek in this order, and only when stuck:** the test names, then the type signatures, then the hint ladder, then the reference file. Each module names its reference file last.
5. **Nothing passes on your say-so.** Every "Prove it" is something you watch happen on real devices.
6. **Ask for a hint, not a fix.** Say "hint" and you get the next rung only.

One timed box is 25 minutes; a deep box is 45.

| Module | What you build | Size |
|---|---|---|
| W1 | A detail is a contribution: the `describe` op | 2 boxes |
| W2 | Who is here: the presence board | 1–2 boxes |
| W3 | One question on repeat: the poll | 3 boxes |
| W4 | Pieces of a file: Range requests | 2 boxes |
| W5 | The code on the screen: pairing and the presenter | 2–3 boxes |
| W6 | A film arrives whole: streamed upload | 2 deep boxes |
| W7 | Storage that survives: IndexedDB | 2 deep boxes |
| W8 | Gallery and reader | 4 boxes |
| W9 | The big screen | 3 boxes |
| W10 | Where is my work: the sync screen | 2 boxes |
| W11 | Two radios on a bench | 2 deep boxes |

---

## W1. A detail is a contribution · the `describe` op

**Story.** Rosa knows the photograph is from 1961. Ama thinks 1962. Both type it in on their own phones, offline. When the phones meet, nobody's answer is erased, and everyone sees the same year.

**Briefing.** A document op is immutable (README D6). So "editing the year" cannot change the document. It has to be a new, small op that says "for this document, this field, I say this value". The screen shows the latest one per field. That rule is called last-writer-wins, and it is applied when you build the view, not when you store.

**Trap.** Mutating the stored document op when a detail arrives. The next merge then sees the same `id` with a different payload, which is the conflict case, on every device.

**Think first.**
- What is the smallest op that expresses one correction? Which fields does it need beyond the base ones?
- One op per field, or one op carrying several fields? Which is better for a 200-byte radio packet, and for undoing one mistake?
- Two people set the year at the same second. What breaks the tie, and is it the same on every device?
- A steward hides a bad detail. What should the screen show then?
- Can a title be emptied? Can a description?

**Build targets.**
- `core/types.ts`: a `Describe` op and a `DescribeField` union, added to `Op`.
- `core/ops.ts`: a create function and a validation case. Unknown fields are rejected.
- `core/views.ts`: documents come out with their effective properties, and a record of who supplied each field.
- `core/store.ts`: one action that takes several changed fields and commits one op per field.

**Fence.** No UI in this module. No change to `mergeOps`.

<details><summary>Hint ladder</summary>

1. Look at how collection names are resolved in `buildViews`. It is the same shape of problem.
2. Walk the log in display order and keep overwriting a copy of the properties. Skip ops whose id is in the hidden set. The original op object must not change.
3. If your "original op is untouched" test fails, you assigned into `doc.properties` instead of building a new object.
</details>

**Prove it.**
- A test where two devices describe the same field, merged in both orders, gives the same value.
- A test where hiding the latest detail falls back to the one before.
- A test that the original document op is byte-for-byte what it was.
- Interview: explain last-writer-wins to someone who has never heard of it, and say one situation where it gives a wrong answer.

**Reference, afterwards:** `core/views.ts` step 3b, and the last two tests in `core/test/views.test.ts`.

---

## W2. Who is here · the presence board

**Story.** The header says "5 online". Rosa closes her phone and walks out. A few seconds later it says "4 online", and nobody had to tell the library she left.

**Briefing.** Presence is the opposite of an op. An op is true forever; "online" is true only now. So it is kept in the node's memory, never written to the log, never merged, never sent by radio. A device is online if it has said hello recently. There is no "goodbye" message, because the devices that vanish are exactly the ones that cannot send one.

**Trap.** Making "joined" and "left" into ops. They would be stored forever, synced to every phone, and sent over LoRa.

**Think first.**
- What does one hello need to carry?
- How long after the last hello is someone gone? What does that number trade off?
- The board needs the current time. How do you keep it testable (README T2)?
- One phone polls five times. How many people is that?
- What should a malformed presence reply turn into on the phone?

**Build targets.**
- `core/presence.ts`: a class with `hello(user, viewing, now)` and `snapshot(now)`, plus a function that reads untrusted presence from the network into a safe shape.
- Types `PresenceEntry`, `Showing`, `Presence` in `core/types.ts`.

**Fence.** No HTTP, no timers, no `Date.now()` inside core.

<details><summary>Hint ladder</summary>

1. This is a map from user to "last seen", and a filter.
2. Do the forgetting inside `snapshot`, so you never need a timer.
3. If your test is flaky, you read the real clock somewhere.
</details>

**Prove it.**
- Tests with fixed times: online, gone after the window, one device counted once.
- Interview: why is there no "leave" message? What would go wrong if there were?

**Reference, afterwards:** `core/presence.ts`, `core/test/presence.test.ts`.

---

## W3. One question on repeat · the poll

**Story.** Rosa posts a note. Two seconds later it is on the big screen and on Ama's phone. Nobody pressed refresh.

**Briefing.** Every open device asks the node the same question every couple of seconds: "what is new since my cursor?" The request also says who is asking and what they have open, so presence costs nothing extra. This is polling. It was chosen over a WebSocket because the same endpoint must later run on an ESP32 drop point, which can only hold a few open connections.

**Trap.** Polling forever at full speed when the node is gone, and showing "Syncing…" in the header every two seconds.

**Think first.**
- What exactly is the cursor? Why is a position in the node's log valid for this node only?
- The reply was lost but the node stored the op. What happens on retry, and why is that safe?
- The tab is hidden. Should it keep polling? What does that do to presence?
- The node is unreachable. How should the delay between attempts change, and to what limit?
- Where does the "viewing" value come from each tick?

**Build targets.**
- Node: `GET /api/ops?after=&user=&viewing=` returns ops, the new cursor, and a presence snapshot.
- `adapters/http-transport.ts`: the pull carries the hello and hands the presence to a callback. The core `Transport` interface does not change.
- `app/sync.ts`: one loop. Visible only. Backs off on failure. Wakes on a new op, on reconnect, on route change. Can be paused.

**Fence.** No WebSocket, no Server-Sent Events, no background sync.

<details><summary>Hint ladder</summary>

1. `LibraryStore.sync` already pushes then pulls. Your loop decides when to call it, not what it does.
2. A single `setTimeout` that re-arms itself is easier to reason about than `setInterval`.
3. Double the delay per failure with a cap; reset it on the first success.
</details>

**Prove it.**
- Two browsers: a note typed in one appears in the other within three seconds.
- Stop the node. The header changes state, and the network tab shows requests slowing down. Start it: everything waiting is sent.
- `curl` the endpoint twice with two user ids and read the presence in the reply.
- Interview: what are the three receipts "queued", "stored", and "seen by others", and which does your UI show?

**Reference, afterwards:** `app/sync.ts`, the `/api/ops` handler in `node/server.ts`.

---

## W4. Pieces of a file · Range requests

**Story.** Ama drags the film's scrubber to the middle and it plays from there. On an iPhone, without this module, the film does not play at all.

**Briefing.** Audio and video elements do not download a whole file. They ask for byte ranges ("give me bytes 500 to 999") and expect status 206 with a `Content-Range` header. Safari refuses to play media from a server that cannot answer these.

**Trap.** Testing only in desktop Chrome, which is forgiving, and finding out at the workshop.

**Think first.**
- What are the three forms a Range header can take?
- What do you answer when the start is past the end of the file?
- What should a HEAD request send?
- Offline, the service worker has the whole file cached. Who cuts the piece then?

**Build targets.**
- Node: one function that sends a whole file or the requested part, used for library files and uploaded media.
- `app/sw.ts`: when a cached response is hit by a ranged request, answer 206 with the slice.

<details><summary>Hint ladder</summary>

1. Read the MDN page on HTTP range requests; the status codes are 206 and 416.
2. `createReadStream` takes `start` and `end`. A `Blob` has `slice`.
3. `end` is inclusive in the header and in `createReadStream`, but exclusive in `Blob.slice`.
</details>

**Prove it.**
- `curl -r 0-99 -i` returns 206, `Content-Range: bytes 0-99/<size>`, and 100 bytes.
- `curl -r 999999999- -i` returns 416.
- The film seeks on a real iPhone, online and after being kept and going offline.

**Reference, afterwards:** `sendFile` in `node/server.ts`, `slice` in `app/sw.ts`.

---

## W5. The code on the screen · pairing and the presenter

**Story.** The facilitator reads six digits off the Pi's own screen, types them into their laptop, and that laptop can now choose what the room looks at. A visitor's phone cannot.

**Briefing.** A capability is a secret that grants one power to whoever holds it. The pairing code is short-lived and human-sized; it is traded once for a long random token the device keeps. Being able to read the Pi's screen is the proof that you are allowed.

**Trap.** Checking the role in the browser. Anything the client decides, a visitor can decide differently.

**Think first.**
- Where must the check happen for it to mean anything?
- A six-digit code has a million values. What stops someone trying them all?
- There can be several presenters but one digitization station. What happens to the old station's token when a new one pairs?
- "What is on the screen" is an op or presence? Why?
- The node restarts. Should paired devices have to pair again?

**Build targets.**
- Node: `POST /api/pair`, `POST /api/showing`; tokens persisted; wrong codes limited.
- The showing state travels inside the presence snapshot from W2.
- App: a pairing form, a "Show on the screen" button only for paired presenters, a banner for everyone else, and "Follow the screen".

<details><summary>Hint ladder</summary>

1. The token is the capability; the code is only how you get one.
2. Keep the showing state on the presence board, so W3's poll delivers it for free.
3. Following is an effect that watches the showing id and changes the route when it changes.
</details>

**Prove it.**
- A wrong code is refused; five in a row are refused for a minute.
- `curl` to `/api/showing` without a token gets 403.
- A paired laptop shows a document; a phone's banner appears within three seconds; with "Follow" on, the phone moves when the laptop moves.
- Interview: what can someone do if they photograph the pairing code? How would you limit that?

**Reference, afterwards:** the pairing section of `node/server.ts`, `app/components/NowShowing.tsx`.

---

## W6. A film arrives whole · streamed upload

**Story.** The digitization station sends a 900 MB film to the Pi. The Pi's memory use barely moves.

**Briefing.** Reading a request body into memory and then writing it out works for a photo and kills the node for a film. Streaming means each chunk goes to disk as it arrives. Hashing it on the way past gives the file its content address, so the same film uploaded twice is stored once.

**Trap.** Trusting `Content-Length`, or the filename, or the declared type.

**Think first.**
- Where do the bytes go before you know their hash?
- The upload dies at 60%. What is left on disk, and what cleans it up?
- Which file types does a library accept, and where is that decided?
- The op that describes the film: who creates it, and when relative to the upload?
- Why does a phone photo take a different path from a station file?

**Build targets.**
- Node: `POST /api/upload`, station token required, body streamed to a temporary file, renamed to its SHA-256 on completion, size capped.
- Transport: an upload with progress.
- `AddDocument`: when paired as the station, accept any supported file and show progress.

<details><summary>Hint ladder</summary>

1. `req.pipe(writeStream)` moves the bytes; a `data` listener can feed the hash at the same time.
2. Write to a dot-prefixed temporary name in the same folder, then rename. A rename within one folder is atomic.
3. `fetch` cannot report upload progress; `XMLHttpRequest` can.
</details>

**Prove it.**
- Upload a file and compare the returned hash with `shasum -a 256`.
- Kill the upload halfway; no partial file remains under its final name.
- Watch the node's memory during a large upload.
- Interview: what is a content address, and what does it give an archive?

**Reference, afterwards:** `receiveUpload` in `node/server.ts`.

---

## W7. Storage that survives · IndexedDB

**Story.** Ama adds forty photos offline. With the first storage adapter, the thirty-first fails. With this one, they all save.

**Briefing.** `localStorage` holds about 5 MB and rewrites the whole op list on every save. IndexedDB stores each op as its own record, inside transactions, with far more room. Because the store only knows the `StorageAdapter` interface, this is a new file and one changed line in `app/index.tsx`.

**Trap.** Resolving your promise on the request's success rather than the transaction's completion. The data is only durable when the transaction completes.

**Think first.**
- What are the object stores, and what is each one's key?
- A batch of three ops: one transaction or three? What does "all or nothing" buy you here?
- What happens when the browser blocks IndexedDB, and what should the app fall back to?
- How do you prove it survives closing the tab?

<details><summary>Hint ladder</summary>

1. Wrap `IDBRequest` in a promise once, and reuse it.
2. For writes, listen to the transaction's `oncomplete`, `onerror` and `onabort`.
3. If nothing is saved, check whether `onupgradeneeded` created the stores.
</details>

**Prove it.**
- Add notes, close the browser entirely, reopen with the node stopped: they are there.
- The core store tests still pass with no changes to core.
- Interview: what is a transaction, in one sentence, and why does "saved" mean after it completes?

**Reference, afterwards:** `adapters/indexeddb-storage.ts`.

---

## W8. Gallery and reader

**Story.** The front page is a wall of documents. You tap one. The document sits on the left; on the right is everything known and said about it, and a place to add more.

**Briefing.** The header is the same on every page and holds the gallery's controls, so the search text and the kind filter are shared state, not component state. On a phone the reader is one column: document first, panel below.

**Trap.** Letting a component build an op. Components call store actions (README D4).

**Think first.**
- Where do the search text and filter live, given the header owns the inputs and the gallery owns the list?
- What does searching cover? Titles only, or the notes too?
- At what width does the reader become two columns, and which column keeps its place when you scroll?
- The details form: how do you send only the fields that changed?
- Where does "Rosa is also viewing this document" get its data?

**Build targets.**
- `Header`, `Gallery`, `DocumentCard`, `SingleDocumentView`, `DetailsForm`.
- Tap targets at least 44 px; sizes in `rem`.
- Empty, loading and missing-document states for each.

<details><summary>Hint ladder</summary>

1. A signal exported from `app/state.ts` can be read by two components.
2. CSS grid with one column by default and two inside a `min-width` media query; `position: sticky` on the document column.
3. Keep a draft object of edited fields and compare each to the current value at save time.
</details>

**Prove it.**
- On a real phone: no sideways scrolling anywhere, and every control reachable with a thumb.
- Change two details; exactly two ops appear in the sync screen's waiting list while paused.
- With VoiceOver or TalkBack, you can open a document and post a note.
- Interview: why is the filter not `useState` inside the gallery?

**Reference, afterwards:** `app/components/`, `styles.css`.

---

## W9. The big screen

**Story.** The projector shows the poem, a code to scan, who is in the room, and each note as it lands.

**Briefing.** The screen only displays. It shows whatever the presence snapshot says is showing. The join code must be drawn without the internet, so the QR generator is bundled into the app.

**Trap.** Showing `localhost` as the address to join. That is the screen's name for itself; no phone can reach it.

**Think first.**
- How does the screen learn the node's address on the Wi-Fi?
- New notes should stay in view. What must not scroll when they do?
- What does the screen show when nothing has been chosen?
- A long poem is taller than the screen. Is the top reachable?

<details><summary>Hint ladder</summary>

1. The node knows its own network addresses; give the app an endpoint that reports them.
2. Set the notes box's own `scrollTop`; `scrollIntoView` moves every ancestor.
3. Centring with overflow hides the top; look up `align-items: safe center`.
</details>

**Prove it.**
- Scan the code with a phone on the same Wi-Fi and land in the library.
- Post from the phone; the note appears on the screen without the document moving.
- Interview: why bundle the QR library instead of calling a QR web service?

**Reference, afterwards:** `app/components/Present.tsx`, `QrCode.tsx`.

---

## W10. Where is my work · the sync screen

**Story.** Ama's phone says "3 waiting". She opens the sync screen and sees exactly which three notes, where they are stuck, and a button to try now.

**Briefing.** This screen replaces a separate network app. It answers three questions: what is still only on this device, what has reached the library, and can I control when it goes. When drop points exist, a middle stop appears between the two.

**Think first.**
- Which facts does the store already hold, and which does only the node know?
- What does "pause" actually stop?
- How will you word a waiting op so a visitor understands it?

**Prove it.**
- Pause, post two notes, see them listed, resume, watch the list empty.
- Interview: RR00 asks how a phone is told "the drop point has it" versus "the archive has it". What would have to travel back for this screen to show that?

**Reference, afterwards:** `app/components/SyncScreen.tsx`.

---

## W11. Two radios on a bench

**Story.** Two boards a table apart. You type a note on one laptop; it arrives on the other, by radio, with a receipt.

**Briefing.** Before any phone or app is involved, prove the layer underneath: these boards, these pins, these antennas, these settings. The modem firmware only frames, sends, receives and hands over; it speaks one JSON object per line over USB.

**Trap.** Powering a board with no antenna attached. Transmitting into nothing can damage the radio.

**Think first.**
- Which pins does the SX1262 need, and where do you find them for your exact board?
- Your XIAO's antenna switch has a receive-enable line. What happens if nothing drives it?
- Which settings must be identical on both boards?
- What are the three messages in a successful exchange, and which one lets the sender forget its copy?

**Build targets.**
- A board section in `firmware/include/config.h` and environments in `platformio.ini`.
- A script that drives two modems over serial and reports delivery both ways.

<details><summary>Hint ladder</summary>

1. Meshtastic's `variant.h` for your board lists its LoRa pins.
2. RadioLib has `setRfSwitchPins` for the receive-enable line.
3. If `radio` is `false` in the hello line, the pins or the TCXO voltage are wrong, not the antenna.
</details>

**Prove it.**
- `node scripts/radio-test.mjs <port A> <port B>` passes both ways.
- Move one board to another room and record delivery and signal strength.
- Unplug one board mid-test, plug it back in: nothing is duplicated.
- Interview: why does only the op travel by radio, and never the photo?

**Reference, afterwards:** `firmware/`, `scripts/radio-test.mjs`.
