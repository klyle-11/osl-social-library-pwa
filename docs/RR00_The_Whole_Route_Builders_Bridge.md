# The Whole Route, Built Up Step by Step

## From plain ideas to the real technical words, with worked examples

*Builder's bridge edition — September 23, 2026*
*Sits between "Told Simply" and the technical RR00 module.*

---

## How to read this

This version is for the person who is going to build the thing, but hasn't built this kind of thing before. It starts from the same plain ideas as the "Told Simply" edition, then climbs toward the technical words you'll meet in documentation, error messages, and forums.

Every new idea follows the same four steps:

1. **The plain idea.** What's actually going on, in everyday words.
2. **The technical word.** What people who build this call it.
3. **What the word means.** A short, careful definition.
4. **A worked example.** A small, concrete case you can trace through by hand.

New terms appear in **bold** the first time they show up. There's a glossary at the end, in the order you meet the words.

This isn't a set of finished instructions. You still build it yourself. The goal is that when you open a guide or a manual, the words already mean something to you.

---

## The route at a glance

The plan has seven **gates**, done in order. A gate isn't passed until you've seen it work on real devices and written it down.

1. **The contract.** Decide exactly what a contribution looks like and how everyone's contributions combine.
2. **The node.** Set up the small computer at the archive that stores everything and trades it with devices.
3. **Trusted, secure access with no internet.** Make phones trust the node while the building is offline.
4. **The web app.** Build the part that lives on phones and keeps working away from the archive.
5. **The phone test.** Prove it on a real iPhone and a real Android phone.
6. **The workshop pilot.** Real people use it.
7. **The radio link.** Contributions travel home by long-range radio.

Gates one through six are a complete product. Gate seven is an extension. If time runs out after gate six, you've still finished something real.

**Session habits.** Work in timed boxes: twenty-five minutes for ordinary work, forty-five for deep work. Before each session, ask: which gate am I on, what does "done" mean for it, what's the one thing I'll make observably true today, and what belongs in the **parking lot** (the list of good ideas that belong to later)?

---

## The big decisions, now with their names

These four choices are already made. Here they are with the technical words attached.

### Decision one: it runs in the browser

**The plain idea.** People open it like a website, then put a button for it on their home screen, and it works almost like an app.

**The technical word.** A **progressive web app**, usually shortened to **PWA**.

**What it means.** A PWA is an ordinary website built with HTML, CSS, and JavaScript, plus a few extra pieces that let the phone treat it like an installed app. Those extra pieces let it open without a connection, keep its data on the phone, and sit on the home screen with its own icon. You'll build each of those pieces in gate four.

- **HTML** describes what's on the page: headings, buttons, images.
- **CSS** describes how it looks: colors, sizes, spacing.
- **JavaScript** describes what it does: what happens when you tap a button, how data gets saved.

**Worked example.** Someone scans a code and lands on `https://library.example.org`. Their phone's browser downloads the HTML, CSS, and JavaScript and shows the library. They tap "Add to Home Screen." Now there's an icon. Tapping it opens the same website, but full-screen and without the browser's address bar, so it feels like an app. Nothing came from an app store.

### Decision two: the small computer is the node

**The plain idea.** A card-deck-sized computer at the archive is home base.

**The technical words.** A **Raspberry Pi**, acting as a **server** and as the **node**.

**What they mean.** A Raspberry Pi is a small, inexpensive, full computer. A **server** is any program that waits for other devices to ask it for things and then answers. The devices doing the asking are called **clients**. Here, phones are the clients and the Pi is the server. **Node** is the word this project uses for one self-contained station in the network: the Pi, its storage, and everything it serves.

**Worked example.** A phone asks the Pi, "Please send me the library page." The Pi's server program finds the page and sends it back. That ask-and-answer pair is called a **request** and a **response**. The rules for how web requests and responses are written are called **HTTP**.

### Decision three: contributions are only ever added

**The plain idea.** Every contribution is a postcard with a unique serial number. Put all the postcards in one pile, toss exact duplicates, and never write over anyone else's.

**The technical words.** Each postcard is an **operation**, often shortened to **op**. The pile of all ops is the **operation log**, or **op log**. Combining piles is called **merging**. This particular way of merging makes the op log a **grow-only set**, which is one simple kind of **CRDT**.

**What they mean.**

- An **operation** is one small record describing one thing someone did: added an item, wrote a comment, and so on.
- The **op log** is the full collection of operations a device knows about.
- A **set** is a collection where each thing appears only once.
- A **grow-only set** is a set you can add to but never remove from.
- A **CRDT**, short for **conflict-free replicated data type**, is a way of storing data so that many devices can each change their own copy, even without talking to each other, and then combine their copies later without conflicts. Every device that combines the same operations ends up with the same result.
- Each device's copy is called a **replica**.

**Worked example.** You'll work through this one in detail in gate one.

### Decision four: small radio boards on both ends

**The plain idea.** Small radio boards carry the postcards, never the heavy photos.

**The technical words.** **LoRa** radio, using **ESP32-S3** boards, which are **microcontrollers**.

**What they mean.**

- **LoRa**, short for "long range," is a kind of radio that can send small messages a long distance using very little power. The trade-off is that it's slow and each message is tiny, on the order of a couple hundred bytes. A **byte** is one unit of stored data, roughly one letter of plain English text.
- A **microcontroller** is a tiny computer on a single chip. It's much simpler than a Raspberry Pi. It doesn't run a normal operating system; it runs one program you load onto it.
- The **ESP32-S3** is a popular, inexpensive microcontroller that also has Wi-Fi built in. You attach a LoRa radio to it, or buy a board that already has one.

**Worked example.** One comment might be around 200 bytes. A single photo can be 3,000,000 bytes, which is 3 megabytes. Sending that photo over LoRa would take thousands of radio messages, and could take hours. That's why only operations travel by radio.

### Two rules that follow

**What you collect is what you carry.** A person's collection defines what gets copied to their phone for offline use.

**Access control happens at export time.** **Access control** means deciding who may see or do what. A common way to organize it is **role-based access control**, or **RBAC**, where permissions belong to roles (like "visitor," "community member," "steward") and people are given roles. **Export** means copying data out of the node to somewhere else. Once data is on someone's phone, the node can't enforce anything, so it must decide what to include before the data leaves.

**Worked example.** A collection contains ten items. Two are marked "community members only." A visitor asks to take the collection home. The node checks the visitor's role and packs only the eight public items. The two restricted items never leave the Pi, so there's nothing on the phone to protect.

---

## The trap

Building the exciting layer before the one it depends on. Radio before phones can hold data. Offline support before secure access exists. Polishing screens before the operation format is settled.

And testing only on a laptop. Phones, especially iPhones, handle storage and installed web apps differently. A gate involving phones only counts when you've seen it on phones.

---

## Gate one: the contract

### The plain idea

Decide the rules of the game before building the board. What does a contribution look like, and how do everyone's contributions get combined?

### The words

**Contract.** An agreement about the exact shape of data, so every part of the system reads it the same way. If the phone and the Pi disagree on what a comment looks like, things break in confusing ways.

**Schema.** A precise description of the fields a record must have and what type each field is. The contract is made of schemas.

**JSON.** Short for JavaScript Object Notation. A common text format for writing structured data. It uses curly braces for a record, `"name": value` pairs for fields, and square brackets for lists. Most web tools read and write it.

**Field.** One named piece of a record, like `author` or `created`.

**Unique ID.** A label that no other record will ever have.

### Worked example: one operation

Here's a comment, written as JSON:

```json
{
  "id": "phone-7Q2K:14",
  "type": "comment",
  "author": "phone-7Q2K",
  "target": "item-0031",
  "created": "2026-10-04T14:22:05Z",
  "body": "That's the corner store on Dickinson Street."
}
```

Reading it field by field:

- `id` — this operation's unique ID. Here it's made from the device's own ID plus a counter: this is the fourteenth operation this phone ever made. Two phones can't collide, because their device IDs differ, and one phone can't collide with itself, because its counter only goes up.
- `type` — which kind of operation this is.
- `author` — which device (or person) made it.
- `target` — what it's about. Here, catalog item number 31.
- `created` — when. The format `2026-10-04T14:22:05Z` is called **ISO 8601**. The `Z` means the time is in **UTC**, a worldwide reference time, so devices in different time zones agree.
- `body` — the comment itself.

The five operation types are:

| Type | Plain meaning |
|---|---|
| `item` | Here's something new for the library |
| `comment` | Here's what I think about something |
| `add-to-collection` | Put this item in my named group |
| `name-collection` | Call my group this |
| `hide` | Keep this out of sight (for moderators; nothing is deleted) |

### Worked example: merging two phones

Phone A knows these operations: `A:1`, `A:2`, `B:1`.
Phone B knows these: `B:1`, `B:2`.

Merge means: combine both lists and keep one copy of each ID.

Result: `A:1`, `A:2`, `B:1`, `B:2`.

Notice `B:1` appeared on both phones but shows up once in the result. Now check three properties:

- **Commutative** — the order you combine in doesn't matter. Merging A into B gives the same result as merging B into A.
- **Associative** — the grouping doesn't matter. Merging A with B, then with C, gives the same as merging B with C, then with A.
- **Idempotent** — doing it again changes nothing. Merging the result with Phone A a second time still gives `A:1`, `A:2`, `B:1`, `B:2`.

Those three properties are exactly what makes a grow-only set a CRDT. They're why messages can arrive late, out of order, or twice, and everything still ends up the same.

### Worked example: naming a collection twice

What if someone names a collection "Church picnics," then later renames it "Summer gatherings"? Both operations stay in the log; nothing is deleted. To decide which name to show, you use a rule called **last-writer-wins**: show the name from the most recent `name-collection` operation. Add one more rule: only the collection's owner can name it. That prevents two different people from fighting over the name.

A value decided this way is called a **last-writer-wins register**, or **LWW register**. It's another simple kind of CRDT.

### Worked example: views

People don't look at a raw op log. They see the feed, collections, and comment threads. Each of these is a **derived view**, sometimes called a **projection**: something computed from the op log, never stored separately as the source of truth.

For item 31, the comment thread view is: "every `comment` operation whose target is `item-0031`, not hidden, sorted by `created`." If you deleted every view, you could rebuild them all from the op log.

### Worked example: the bundle

A **bundle** is the package used when data travels between devices as a file. It has two parts:

1. The ops being sent.
2. A **manifest**: a list of the media files that go with them.

Each media file in the manifest is identified by a **hash**. A hash is a short fingerprint computed from a file's exact contents. The same file always gives the same hash, and changing even one pixel gives a completely different one. A common hashing method is called **SHA-256**.

```json
{
  "ops": [ { "id": "phone-7Q2K:14", "type": "comment", "...": "..." } ],
  "manifest": [
    { "hash": "sha256-9f2c…e41a", "name": "corner-store-1962.jpg", "bytes": 2841233 }
  ]
}
```

Identifying files by their contents is called **content addressing**. It means that if two people have the same photo, the system knows it's the same file even if they named it differently.

### What you build

Schemas for the five operation types. A merge function. The derived views. The bundle format. A set of **fixtures**, which are small, fixed sample data files used for testing.

**Pure function** is a useful term here. It's a piece of code that, given the same inputs, always gives the same output, and doesn't read or change anything outside itself: no files, no network, no clock. Your merge and your views should be pure functions. That makes them easy to test and means they'll behave the same on a phone, on the Pi, and on your laptop.

### Off limits

No screens, no network, no storage. Just the contract, the pure functions, and fixtures.

### Done when

Your fixtures merge to the same result in any order. Merging the result again changes nothing. A bundle exported and imported comes back identical.

---

## Gate two: the node

### The plain idea

The small computer at the archive hands out the library, keeps every contribution safe, and trades contributions with visitors.

### The words

**Serving files.** Sending the app's HTML, CSS, and JavaScript, plus the archive's documents, to whoever asks.

**Endpoint.** One specific address on the server that does one specific job, like `/sync`. Endpoints are how clients ask the server for particular things.

**Sync.** Short for synchronize. Two devices exchange whatever the other one is missing, so both end up with the same data.

**Database.** A program for storing records so they can be found and updated reliably. **SQLite** is a small database that lives in a single file, which suits a Raspberry Pi well.

**Durable.** Stored in a way that survives a crash or power loss. Data held only in the computer's working memory is not durable; data safely written to the disk is.

**Acknowledgment**, or **ack.** The server's reply that says "I've got it, and it's safe." The rule is: never ack until the data is durable.

**Idempotent**, again. Receiving the same operation twice has the same effect as receiving it once.

### Worked example: a sync exchange

The Pi gives every operation it receives its own running number, in order of arrival. This is separate from the operation's ID. Call it the Pi's **sequence number**.

The phone remembers the last sequence number it has seen. This remembered position is called a **cursor**.

1. The phone's cursor is 120. It has two new operations that haven't been sent yet: `phone-7Q2K:14` and `phone-7Q2K:15`.
2. The phone sends a request to `/sync`: "Here are my two new operations. Send me everything after number 120."
3. The Pi checks each incoming operation. It already has `:14` (perhaps from an earlier attempt that lost its reply), so it ignores the duplicate. `:15` is new, so it saves it to the database and gives it sequence number 127.
4. The Pi only replies after the save has finished. That's what makes the reply an honest ack.
5. The reply says: "Both of yours are safe. Here are numbers 121 through 127." That includes other people's contributions, and the phone's own `:15`, which it will recognize by ID and ignore.
6. The phone merges what it received and moves its cursor to 127.

Notice how the gate-one properties make this safe. The duplicate `:14` caused no harm, and receiving its own operation back caused no harm.

### What you build

A server program on the Pi that serves the app and documents, stores ops durably in a database, and has a sync endpoint that works like the example.

### Off limits

Plain `http://` addresses are fine here; security comes in gate three. No offline support. No phones needed: two browsers on two laptops are enough.

### Done when

Two laptop browsers add contributions through the Pi and see each other's. Pulling the Pi's power loses nothing that was acknowledged. Sending the same operation twice leaves one record.

---

## Gate three: trusted, secure access with no internet

### The plain idea

Phones only let a website keep working offline if they trust where it came from. That trust is shown by the padlock. Normally earning the padlock needs the internet, so you need a workaround.

### The words

**HTTPS.** The secure version of HTTP. The "S" stands for secure. Traffic is **encrypted**, meaning scrambled so only the intended device can read it, and the phone can check the server is really who it says it is.

**TLS.** Short for Transport Layer Security. It's the encryption system underneath HTTPS.

**Certificate.** A small digital document that says, "This server really is `library.example.org`." Think of it as an ID card for a website.

**Certificate authority**, or **CA.** An organization phones already trust to issue certificates. **Let's Encrypt** is a free, widely used CA.

**Secure context.** A browser term for a page loaded over HTTPS, or from your own computer. Many powerful browser features only work in a secure context. The offline feature you need in gate four is one of them.

**Domain name.** A human-readable web address, like `library.example.org`. You rent one yearly from a company called a **registrar**.

**DNS**, short for Domain Name System. The internet's phone book. It turns a domain name into an **IP address**, which is the numeric address of a machine on a network, like `192.168.1.50`.

**DNS record.** One entry in that phone book. An **A record** says "this name lives at this IP address." A **TXT record** holds a piece of text, often used to prove you control a domain.

**DNS-01 challenge.** One way to prove to Let's Encrypt that you control a domain. Let's Encrypt gives you a random code; you publish it as a TXT record in your domain's public DNS; Let's Encrypt looks it up and, finding it, issues the certificate. Crucially, the Pi itself never needs to be reachable from the internet for this to work.

**Local DNS resolver.** A small DNS server running on your own network that answers phone-book questions for devices nearby. A common program for this on a Pi is **dnsmasq**. When your local resolver gives a different answer than the public internet would, that's called **split-horizon DNS**.

**DHCP.** The system that hands devices their network settings when they join a Wi-Fi network, including which DNS server to use.

### Worked example: getting the certificate

This happens once, while you still have internet, and again whenever the certificate needs renewing.

1. You rent `library.example.org`.
2. You ask Let's Encrypt for a certificate for that name.
3. Let's Encrypt replies: "Publish this code as a TXT record at `_acme-challenge.library.example.org`."
4. You add that record through your registrar or DNS provider.
5. Let's Encrypt checks the public DNS, finds the code, and issues the certificate.
6. You install the certificate on the Pi.

### Worked example: a phone connecting with no internet

1. A phone joins the archive's Wi-Fi. DHCP tells it: "For phone-book questions, ask 192.168.1.50." That's the Pi.
2. The person opens `https://library.example.org`.
3. The phone asks the Pi's local resolver: "Where is `library.example.org`?" The Pi answers: "192.168.1.50. That's me."
4. The phone connects to the Pi and asks for its certificate.
5. The certificate says `library.example.org`, was issued by Let's Encrypt, and hasn't expired. The phone already trusts Let's Encrypt, and checking the certificate doesn't need the internet, so the padlock appears.
6. The page is now a secure context. Offline features are allowed.

### Things to watch

**Expiry.** Let's Encrypt certificates currently last ninety days, and shorter lifetimes have been announced. You need a renewal plan: the Pi occasionally gets internet and renews itself, or you renew from another machine and copy the new certificate over.

**Phones ignoring your phone book.** Android has a "Private DNS" setting. When it's set to a specific provider, the phone may skip your local resolver entirely. Add this to your phone test.

**The radio station later.** The remote radio board in gate seven must use the same name and the same certificate, or phones won't trust it.

### What you build

The domain, the certificate, the local resolver on the Pi, and the network settings so phones use it.

### Off limits

Don't touch the app. This gate is only about trust and addressing.

### Done when

With the internet unplugged, an iPhone and an Android phone both open the HTTPS address and show a valid padlock with no warnings. Your log says how renewal will happen.

---

## Gate four: the web app

### The plain idea

The part on people's phones: it opens with no signal, holds contributions safely, sends them home when it can, and lets people take collections with them.

### The words

**Web app manifest.** A small JSON file describing the app: its name, icon, colors, and how it should open. It's what makes "Add to Home Screen" produce a proper app icon.

**Service worker.** A special piece of JavaScript that the browser installs alongside your site and keeps running separately from the page. It sits between the page and the network, like a doorkeeper. When the page asks for a file, the service worker can answer from a saved copy instead of the network. Service workers only work in a secure context, which is why gate three came first.

**Cache.** A stored copy of something, kept so you don't have to fetch it again. The **Cache Storage** feature lets a service worker save copies of files.

**App shell.** The minimum files needed to show the app's frame: the main HTML, CSS, JavaScript, and icons. Caching the app shell is what makes the app open with no signal.

**IndexedDB.** A database built into every modern browser. It stores structured records, like your operations, on the device itself.

**Transaction.** A group of database changes that either all happen or none happen. If the phone dies mid-save, a transaction guarantees you don't end up with half a record.

**Outbox**, or **pending queue.** A list of operations made on this device that the node hasn't acknowledged yet.

**Persistent storage.** Browsers may clear a site's stored data when the phone runs low on space. A site can ask for its storage to be marked persistent, using a request called `navigator.storage.persist()`, which makes that much less likely.

**Share sheet.** The phone's built-in "Share" menu. The **Web Share** feature lets a website hand a file to that menu, so the person can save it to Files, send it to themselves, or AirDrop it.

**Authorization.** Checking whether a particular person is allowed to do a particular thing. This is where the role-based access control from earlier gets enforced.

### Worked example: opening with no signal

1. First visit, at the archive, with a connection: the browser loads the site and installs its service worker. The service worker saves the app shell into the cache.
2. Later, on a bus with no signal, the person taps the home-screen icon.
3. The page asks for the main HTML file. The service worker intercepts the request, sees there's no network, and answers from the cache.
4. The app opens. It reads the person's operations from IndexedDB and builds the views.

### Worked example: writing a comment with no signal

1. The person writes a comment and taps Save.
2. The app creates the operation, with the next ID from this device's counter, say `phone-7Q2K:16`.
3. In one IndexedDB transaction, it adds the operation to the op log and adds its ID to the outbox. Either both happen or neither does.
4. The comment appears on screen, marked as "waiting to send."
5. Days later, back at the archive, the person opens the app. It reaches the Pi and runs the gate-two sync exchange.
6. The Pi acknowledges `:16`. The app removes it from the outbox, and the mark changes to "saved at the archive."

Note: iPhones don't run web apps in the background, so syncing only happens while the app is open. The outbox holds everything safely until then.

### Worked example: taking a collection home

1. The person taps "Take this group with me."
2. The app asks the Pi for that collection.
3. The Pi checks authorization: which items is this person's role allowed to take?
4. The Pi sends the allowed operations, plus a manifest of the allowed media files.
5. The app stores the operations in IndexedDB and downloads each media file into the cache.

"Save my collection" works the same way, except the app packs a bundle file and hands it to the share sheet.

### What you build

The manifest, the service worker and app-shell cache, IndexedDB storage with an outbox, sync on open, the persistent storage request, "take this group with me," "save my collection," and authorization checks on the Pi.

### Off limits

Start on your own computer using the address `localhost`, which browsers treat as a secure context, so you don't need gate three to begin. Keep the design plain. Nothing from the parking lot.

### Done when

On your laptop: turn the network off, add contributions, close everything, reopen, add more, turn the network on, and the Pi receives each operation exactly once.

---

## Gate five: the phone test

### The plain idea

Prove it on real phones, carefully, with a checklist.

### The words

**Airplane mode.** A phone setting that turns off all wireless connections. The easiest way to simulate "no signal."

**Force-quit.** Fully closing an app, not just switching away from it. On iPhone, swipe it away in the app switcher.

**Eviction.** The browser deleting a site's stored data, usually to free up space or because the site hasn't been used for a while.

**Screen reader.** Software that reads the screen aloud for people who are blind or have low vision. On iPhone it's **VoiceOver**; on Android it's **TalkBack**.

**Test matrix.** A grid of test cases against devices, filled in with pass or fail.

### The matrix

Run every case on at least one iPhone (installed to the home screen) and one Android phone (installed through Chrome).

| # | Case | iPhone | Android |
|---|---|---|---|
| 1 | Scan the code and install to home screen | | |
| 2 | Airplane mode: browse a collection taken home | | |
| 3 | Airplane mode: add an item with a photo, comment, name a collection | | |
| 4 | Force-quit, reopen, work still there | | |
| 5 | Restart the phone, work still there | | |
| 6 | Several days offline, work still there (checks eviction) | | |
| 7 | Return, open the app, sync succeeds | | |
| 8 | Same operation sent twice produces one record (checks idempotency) | | |
| 9 | Two phones contribute at once, both appear (checks merge) | | |
| 10 | "Save my collection" reaches Files or Downloads (checks share sheet) | | |
| 11 | Screen reader can add a description to an item | | |
| 12 | Android "Private DNS" setting doesn't bypass the Pi's resolver | | |

### Off limits

Fix only what the matrix reveals.

### Done when

Every cell passes, or has a written workaround you'd be comfortable explaining to a workshop participant.

---

## Gate six: the workshop pilot

### The plain idea

Real people use it, and you watch and write down what happens.

### The words

**Seed content.** Items, comments, and collections you add ahead of time so the space doesn't feel empty.

**QR code.** The square barcode a phone camera can read, here containing the library's address.

**NFC tag.** A small sticker with a chip that a phone can read by tapping it. It can also hold an address.

**Onboarding.** Everything that happens from the moment a person first encounters the app until they've done their first meaningful thing.

**Time to first action.** How long onboarding takes. Shorter is better.

**Pilot.** A small, real trial run before a wider launch.

### What you prepare

Seed content. A QR code, an NFC tag, or both. A projector or TV showing the live feed. A shared "add to home screen" moment with an illustrated guide, since iPhones hide that option inside the Share menu. Two or three prompts, like "Find something that reminds you of home."

### Off limits

No new features during the pilot week. Write requests down. Don't build them yet.

### Done when

A real group used it, and you recorded how many contributed, the time to first action, how many installed it, and every sync failure. At least one person's offline work came back afterward.

---

## Gate seven: the radio link

### The plain idea

A small radio at the archive and another out in the neighborhood pass contributions back and forth through the air, with no internet.

### The words

**Serial connection.** A simple way for two devices to send data to each other one byte at a time over a wire. Here, the ESP32-S3 connects to the Pi with a USB cable, and the Pi sees it as a serial port.

**Frame.** One wrapped-up message, with enough extra information that the receiver can tell where it starts and ends, and whether it arrived undamaged. Doing this wrapping is called **framing**.

**Payload.** The actual content inside a frame, as opposed to the wrapping.

**Checksum**, or **CRC** (cyclic redundancy check). A small number calculated from the payload. The receiver recalculates it; if the numbers don't match, the frame was damaged in transit.

**Fragmentation.** Splitting something too big for one frame into several smaller pieces, each numbered, to be put back together on arrival. The pieces are called **fragments** or **chunks**.

**Retransmission.** Sending a frame again because no ack came back in time.

**Store-and-forward.** Holding a message until the next hop confirms it has it, and only then letting go of your own copy.

**Flash memory.** The built-in storage on a microcontroller, which keeps its contents without power. Larger storage can be added with an **SD card**.

**Firmware.** The program loaded onto a microcontroller.

**ISM band.** A set of radio frequencies that can be used without an individual license, under rules. In the United States, LoRa uses the band from 902 to 928 megahertz, often just called "915."

### Worked example: one comment across the radio

The comment `phone-7Q2K:16` is 230 bytes as JSON. Suppose you decide each frame's payload can be at most 100 bytes. (Deciding that number is part of your decision map.)

**Fragmenting.** 230 bytes needs three fragments: 100, 100, and 30 bytes.

**Framing.** Each fragment is wrapped like this:

```
[ start marker ][ length ][ message ID ][ fragment 1 of 3 ][ payload … ][ checksum ]
```

- The **start marker** is a fixed byte that means "a frame begins here."
- The **length** says how many bytes follow, so the receiver knows where the frame ends.
- The **message ID** ties the fragments together.
- **Fragment 1 of 3** says which piece this is.
- The **payload** is the piece of the comment.
- The **checksum** lets the receiver detect damage.

**Sending.**

1. The drop point sends fragments 1, 2, and 3.
2. Fragment 2 is garbled by interference. Its checksum doesn't match, so the Pi-side radio discards it.
3. The Pi side replies: "I have 1 and 3 of message 88. I'm missing 2."
4. The drop point retransmits fragment 2.
5. All three arrive. The Pi side reassembles the 230 bytes and hands the complete operation to the Pi over the serial connection.
6. The Pi stores it in its database, just like any other sync. Then it sends back a final ack: "Operation `phone-7Q2K:16` is durable."
7. Only then does the drop point delete its stored copy. That's store-and-forward.

If a duplicate arrives later, perhaps because an ack was lost and the drop point sent everything again, the Pi recognizes the operation ID and ignores it. Same idempotency as always.

### The three steps

**Step A: the Pi-end modem.** A **modem** here just means a device that turns data into radio signals and back. The ESP32-S3 at the Pi only frames, sends, receives, and hands over. All thinking and storage stay on the Pi. Test the framing from a laptop before you ever involve radio.

**Step B: the remote drop point.** The second ESP32-S3 runs a Wi-Fi network, serves the same sync endpoint over HTTPS using the same name and certificate as the Pi, stores operations in flash or on an SD card, and forwards them by radio. Running HTTPS on a microcontroller is tight on memory, so research this early in the step.

**Step C: the return path.** The Pi sends other people's operations out to the drop point, so remote contributors see the community's additions. Only operations travel. Media stays on the Pi.

### Off limits

Only operations over radio. One radio link. No **mesh networking**, which is where many radios relay messages for each other. No **Reticulum**, a networking system designed for radio links, which belongs in the parking lot for now.

### Done when

With no internet anywhere: a phone contributes offline, syncs later at the drop point, the operation crosses the radio link to the Pi, and it appears on a different phone at the Pi. Duplicates and a mid-transfer restart don't break it.

---

## Decisions to make along the way

Write each one down at the gate where it first matters.

- **Gate one:** How operation IDs are generated (the example used device ID plus counter). How collection names resolve (last-writer-wins, owner only).
- **Gate two:** Exactly when the node sends an ack. The answer should be "after the database transaction finishes."
- **Gate three:** How phones learn to use the Pi's resolver: through the router's DHCP settings, or a Wi-Fi network the Pi runs itself. How and when the certificate renews.
- **Gate four:** How the app shows "waiting to send" versus "saved at the archive." Where authorization is checked.
- **Gate six:** What participants are told about where their contributions go and who can see them.
- **Gate seven:** Maximum payload size per frame. How long to wait before retransmitting. How a phone is told the difference between "the drop point has it" and "the archive has it."

---

## Things to look up, when you reach them

One timed box each.

- **Gate one, 25 minutes:** Grow-only sets and why commutative, associative, idempotent merging is safe.
- **Gate three, 45 minutes:** DNS-01 challenges with Let's Encrypt, and running a local resolver such as dnsmasq. Stop when you can draw the path from phone to padlock.
- **Gate four, 45 minutes:** The service worker lifecycle (how it installs, activates, and updates), IndexedDB transactions, and `navigator.storage.persist()`.
- **Gate five, 25 minutes:** Current iPhone behavior for storage and eviction in home-screen web apps. Check a recent source; it changes.
- **Gate seven, three boxes of 45 minutes:** Serial framing and CRCs. United States rules for the 902–928 megahertz band. HTTPS servers on the ESP32-S3 and their memory limits.

---

## The parking lot

Good ideas that belong to later:

- A **TiddlyWiki** export: a single HTML file containing the app and a person's collection, which opens on any computer.
- A **Capacitor** app: the same web app wrapped as a native app for the stores.
- **Federation**, where separate libraries share with each other. Set aside because access control can't follow data once it spreads.
- Search that understands meaning rather than exact words.
- Reticulum and mesh networking.
- Comments attached to a specific passage or area of a document, rather than the whole item.
- Real-time shared text editing.

---

## The end-of-session log line

Four parts: which gate, what you made true, the evidence (device and observation), and the next thing.

*"Gate two. Two browsers sync through the Pi. Both showed the test comment after refreshing. Next: pull the power and confirm the acked comment survives."*

At the end of each gate, write a short entry: the "done when," the devices used, and anything that surprised you.

---

## When you're stuck: the hint ladder

1. **Name the boundary.** A boundary is any handoff between two parts. Which one is failing: phone to Pi, app to IndexedDB, Pi to radio, radio to radio?
2. **Observe that boundary alone.** Add **logging**, meaning code that writes out what's happening, on both sides of it. Don't guess across it.
3. **Bypass everything else.** Send one fixture operation straight across that single boundary.
4. **Shrink the case.** One operation, one device, one hop. Add pieces back only once it works.

---

## The slow walk, with both kinds of words

Follow one comment from start to finish. At every step, ask: where does it live now, and what could make it disappear?

1. Someone writes a comment with no signal. *The app creates operation `phone-7Q2K:16`.*
2. It's saved on the phone. *One IndexedDB transaction adds it to the op log and the outbox.*
3. It waits. *It stays in the outbox, marked "waiting to send."*
4. The person gets near the drop point. *The phone reaches the drop point's HTTPS sync endpoint.*
5. The drop point keeps it and says "got it." *It writes the operation to flash, then acks the phone.*
6. It goes over the air. *It's fragmented, framed, and sent over LoRa, with retransmission as needed.*
7. The radio at home base catches it. *The Pi-end modem reassembles it and hands it over the serial connection.*
8. Home base keeps it and says "got it." *The Pi saves it in its database and sends a final ack by radio.*
9. The drop point lets go. *Store-and-forward: it deletes its copy only after the final ack.*
10. Someone else sees it. *Another phone syncs with the Pi, merges the new operation, and its comment-thread view shows it.*

If you can't answer the two questions for any step, that's the next boundary to observe.

---

## Proving it

Record about two minutes of the full slow walk happening: phone screens, plus the room, so it's clear there's no internet in the path. Keep your gate log with it.

Then complete the sentence:

> "A contribution made offline on a phone reached the archive with no internet because ______ kept it until ______, and ______ ensured it arrived exactly once."

---

## Glossary, in the order you met the words

| Term | Meaning |
|---|---|
| Gate | One stage of the plan, passed only with observed proof |
| Parking lot | List of good ideas that belong to later |
| PWA (progressive web app) | A website that can be installed and work offline like an app |
| HTML / CSS / JavaScript | What's on a page / how it looks / what it does |
| Raspberry Pi | A small, inexpensive full computer |
| Server / client | The program that answers / the device that asks |
| Node | One self-contained station: here, the Pi and everything it holds |
| Request / response | One ask and its answer |
| HTTP | The rules for web requests and responses |
| Operation (op) | One small record of one thing someone did |
| Op log | All the operations a device knows about |
| Merge | Combining two op logs |
| Set / grow-only set | A collection with no duplicates / one you only add to |
| CRDT | Data that many devices can change separately and combine without conflicts |
| Replica | One device's copy of the data |
| LoRa | Long-range, low-power, low-bandwidth radio |
| Byte | One unit of data, roughly one letter of text |
| Microcontroller | A tiny single-chip computer running one program |
| ESP32-S3 | A popular microcontroller with built-in Wi-Fi |
| Access control / RBAC | Deciding who may do what / doing that through roles |
| Export | Copying data out of the node |
| Contract / schema | Agreement on data shape / precise description of a record's fields |
| JSON | A common text format for structured data |
| Field | One named piece of a record |
| Unique ID | A label no other record will have |
| ISO 8601 / UTC | Standard date-time format / worldwide reference time |
| Commutative / associative / idempotent | Order doesn't matter / grouping doesn't matter / repeating changes nothing |
| Last-writer-wins (LWW) register | A value where the newest write is shown |
| Derived view / projection | Something computed from the op log, not stored separately |
| Bundle / manifest | A travel package of ops / its list of media files |
| Hash / SHA-256 | A fingerprint of a file's contents / a common way to compute one |
| Content addressing | Identifying files by their hash |
| Fixtures | Small fixed sample data for testing |
| Pure function | Same input, same output, touches nothing outside itself |
| Endpoint | One address on a server that does one job |
| Sync | Exchanging what each side is missing |
| Database / SQLite | Reliable record storage / a small single-file database |
| Durable | Survives a crash or power loss |
| Ack (acknowledgment) | "I have it, and it's safe" |
| Sequence number / cursor | The node's arrival order / a device's remembered position in it |
| HTTPS / TLS | Secure HTTP / the encryption underneath it |
| Encrypted | Scrambled so only the intended device can read it |
| Certificate / CA | A website's ID card / the trusted issuer of those cards |
| Let's Encrypt | A free certificate authority |
| Secure context | A page loaded over HTTPS or from your own machine |
| Domain name / registrar | A human-readable address / the company you rent it from |
| DNS / IP address | The phone book of names / a machine's numeric address |
| A record / TXT record | "This name is at this address" / a text entry, often for proof |
| DNS-01 challenge | Proving domain control by publishing a code in DNS |
| Local resolver / dnsmasq | A phone book on your own network / a program for it |
| Split-horizon DNS | Different answers inside your network than outside |
| DHCP | Hands devices their network settings when they join |
| Manifest (web app) | JSON describing the app's name, icon, and launch style |
| Service worker | Browser-installed script that can answer requests from saved copies |
| Cache / Cache Storage | Saved copies / the browser feature for storing them |
| App shell | The minimum files to show the app's frame |
| IndexedDB | The database built into every browser |
| Transaction | Changes that all happen or none do |
| Outbox / pending queue | Operations not yet acknowledged by the node |
| Persistent storage | Browser storage marked "please don't clear" |
| Share sheet / Web Share | The phone's Share menu / how a website hands it a file |
| Authorization | Checking whether a person may do a particular thing |
| Airplane mode / force-quit | All wireless off / fully closing an app |
| Eviction | The browser deleting a site's stored data |
| Screen reader / VoiceOver / TalkBack | Reads the screen aloud / iPhone's / Android's |
| Test matrix | Test cases against devices, pass or fail |
| Seed content | Things added ahead of time so the space isn't empty |
| QR code / NFC tag | Camera-readable square code / tap-to-read sticker |
| Onboarding / time to first action | First experience / how long until the first real action |
| Pilot | A small real trial |
| Serial connection | Byte-by-byte data over a wire |
| Frame / framing | One wrapped message / the act of wrapping |
| Payload | The content inside a frame |
| Checksum / CRC | A number used to detect damage |
| Fragmentation / fragment | Splitting a message / one piece of it |
| Retransmission | Sending again when no ack arrives |
| Store-and-forward | Hold until the next hop confirms, then let go |
| Flash memory / SD card | Built-in lasting storage / add-on storage |
| Firmware | The program on a microcontroller |
| ISM band | Radio frequencies usable without an individual license, under rules |
| Modem | A device that turns data into signals and back |
| Mesh networking | Many radios relaying for each other |
| Reticulum | A networking system built for radio links |
| Logging | Code that records what's happening |
| TiddlyWiki / Capacitor / Federation | Single-file wiki / native app wrapper / libraries sharing across servers |
