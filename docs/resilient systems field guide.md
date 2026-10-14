# Building Things That Survive: A Ground-Up Field Guide

*A slow walk through the networking, hardware, firmware, software, and ideas behind a local-first, disconnection-tolerant system for holding information and communicating — built to run on modest, durable, "obsolete" hardware.*

---

## How to read this

This document assumes you know how to use a computer and write code, but assumes **nothing** about networking, distributed systems, radio, or firmware. It starts from "how do two machines say anything to each other at all" and builds up to a buildable roadmap. Each section ends roughly where the next begins, so reading start-to-finish should feel continuous rather than like jumping between topics.

There's a glossary at the end. When a bolded term shows up, it's in the glossary.

The throughline of the whole thing: **most computing assumes the network is always there, always fast, and always centrally coordinated. We are going to assume the opposite, and design for it.** Almost everything strange or unfamiliar in here follows from that one inversion.

---

# Part 1 — What we're actually building

Before any background, here's the shape of the thing, so you have a frame to hang the details on.

We want a system with two halves:

1. **A place to keep information** — files, notes, books, annotations — that doesn't live on someone else's server, can't be quietly deleted or changed, and is the *same information* no matter which device it's sitting on.

2. **A way for people and devices to share and sync that information** — even when the internet is slow, broken, or entirely absent. Over local wifi, over long-range radio, by physically carrying a memory card from one place to another. Built to run on cheap, low-power, long-lived hardware rather than the newest phone.

On top of that substrate, the first real application is **annotation**: reading long-form things (articles, books, documents) and attaching notes to specific places in them, then sharing those notes with a small group — all of which has to survive the same disconnection and device-hopping as everything else.

That's it. Everything below is the background needed to understand why each piece is built the way it is, and the order to build them in.

---

# Part 2 — Networking from absolute zero

## 2.1 The only real problem: getting a message from here to there

Strip away every buzzword and networking is one problem: **a message starts in one place and needs to arrive, intact and understood, in another.** Everything else — protocols, addresses, the internet itself — is accumulated machinery for solving that one problem reliably, at scale, between machines that have never met.

Start with two computers connected by a single wire. To send a message, one end has to turn the message into a pattern of electrical signals (high voltage / low voltage, which we read as 1s and 0s), push them down the wire in order, and the other end has to read them back and reassemble the message. That physical act — turning meaning into signals and back — is the bottom of the whole stack. It's called the **physical layer**. Radio is the same idea with the wire removed: the signal travels as electromagnetic waves instead of voltage on copper.

Two immediate problems appear, and they recur at *every* level above this, so they're worth naming now:

- **Framing**: where does one message end and the next begin? If I send you "HELLOWORLD," is that one word or two? Both ends need an agreed rule.
- **Errors**: wires and radio are noisy. A 1 can flip to a 0. Both ends need a way to detect (and sometimes fix) corruption.

The agreement on how to solve framing, errors, and everything else is called a **protocol**. A protocol is just *a set of rules that both sides follow so a stream of signals becomes a shared understanding.* That word — protocol — is going to do enormous work in this document. Almost everything we build is a protocol or a stack of them.

## 2.2 Why we build in layers

Here's a key insight that took the industry decades to settle on: **don't try to solve everything in one protocol. Stack small protocols, each solving one problem, each not caring how the layers below it work.**

The classic way to picture this is a stack where each layer talks only to the layer directly above and below it:

```
   [ Application ]   "what does this message mean?"        (e.g. a web page, an email)
   [ Transport   ]   "did the whole message arrive, in order, intact?"
   [ Network     ]   "which machine, out of billions, is this for?"
   [ Link        ]   "get bits to the next machine on this local wire/radio"
   [ Physical    ]   "turn bits into signals and back"
```

The magic of layering: the application layer doesn't know or care whether the physical layer is copper, fiber, or radio. The network layer doesn't care what the message *means*. Each layer trusts the one below to do its job and offers a clean service to the one above. This is the same instinct as good software design — small pieces with clear boundaries — applied to communication.

You'll hear this called the **OSI model** (a 7-layer teaching model) or the **TCP/IP model** (a 4-layer practical model). The exact number of layers matters less than the idea: **a network is a stack of protocols, each ignorant of the others' internals.** Hold onto that, because the system we're designing is *also* a stack of protocols, just unusual ones.

## 2.3 Addresses, or "which machine, out of billions?"

On a single wire with two machines, "send to the other end" is unambiguous. The moment there are more than two machines, you need **addresses**.

On the internet, the network-layer address is the **IP address** — a number assigned to each machine (like `192.168.1.5` or the longer IPv6 form). When you send data, the network layer stamps it with a destination IP, and a chain of machines called **routers** pass it along, each one looking at the address and deciding "the next hop toward that address is this direction." No single router knows the whole path; each just knows the next step. The message **hops** from router to router until it arrives. This hop-by-hop forwarding idea is going to come back in a big way when we talk about mesh networks — hold onto it.

But IP addresses are numbers, and humans don't remember numbers. So there's a phonebook: **DNS** (Domain Name System) translates `example.com` into an IP address. When you type a web address, your machine first asks DNS "what's the number for this name?", gets an IP back, and *then* sends its actual request to that IP.

Notice something already: **DNS is a point of central control and central failure.** It's run by a hierarchy of servers. If the phonebook is unreachable, or someone removes your name from it, or a government blocks it, your machine can't find anything by name even if the destination machine is perfectly healthy. This is the first crack in the "always there, always central" assumption — and we'll design around it.

## 2.4 Did it actually arrive? TCP vs UDP

The network layer (IP) is *best-effort*: it'll try to deliver your data, but makes no promise. Packets can be lost, duplicated, or arrive out of order. The **transport layer** sits on top and offers two main deals:

- **TCP** — the careful deal. It numbers every chunk, waits for the other side to confirm receipt ("acknowledgment"), re-sends anything lost, and reassembles everything in the right order. When you need the whole thing, intact, in order — files, web pages, messages — you use TCP. The cost: it needs a continuous back-and-forth conversation (a "connection"), which assumes both ends are reachable *at the same time.*

- **UDP** — the fast, careless deal. It fires packets off and doesn't track them. Some may vanish. You use it when speed matters more than perfection — live video, games, voice — and you'll tolerate a little loss.

Here's the crucial thing for us: **TCP assumes both ends are online simultaneously and can talk back and forth.** That assumption is baked so deep into normal networking that most software simply falls over without it. Our entire premise is that this assumption is *often false* — the other device might be a dumb phone that's only near you once a day, or a node across a mesh that's currently unreachable. So a big part of our work is operating *above* or *around* TCP's assumption. This is the seam where "resilient, disconnection-tolerant" stops being a slogan and becomes specific engineering.

## 2.5 The two shapes of a network: client-server vs peer-to-peer

One more foundational distinction, and it's arguably *the* defining choice of the whole project.

**Client-server** is the shape of almost everything you use. There's a powerful machine somewhere (the server) that holds the authoritative copy of everything and coordinates all interaction. Your device (the client) is mostly a window onto the server. Your messages, your documents, your social graph — they live on the server; you're borrowing a view. This is efficient and easy to reason about. It's also a single point of control and a single point of failure: if the server goes down, is shut off, gets sold, or decides to lock you out, everything's gone. The server's owner holds all the power.

**Peer-to-peer (P2P)** is the other shape. There's no privileged central machine. Every device is a "peer" — it holds its own copy of what it cares about, and peers talk directly to each other to share and sync. There's no one to shut off, because there's no center. The cost: it's *much* harder to coordinate. Without a central authority deciding "this is the true, current state," peers can disagree, and you need clever machinery to let them reconcile. Most of the genuinely hard and interesting parts of our system come from choosing P2P and then dealing honestly with the consequences.

We are building something close to P2P, with optional helpers. The reason is values as much as engineering: **a system designed to survive — disconnection, institutional neglect, infrastructure collapse, the death of any company — cannot have a center that can be switched off.**

---

# Part 3 — Designing for a world that disconnects

Now we take the inversion seriously. Normal networking assumes continuous, simultaneous connectivity. We assume intermittent, partial, sometimes-absent connectivity. A whole research field exists for exactly this, and borrowing its vocabulary makes the project legible instead of vague.

## 3.1 Delay-Tolerant Networking and "store and forward"

The field is called **Delay-Tolerant Networking (DTN)**, and its origin story is perfect: it came from designing networks for *space.* A probe near Mars can't hold a live TCP conversation with Earth — the round-trip delay is many minutes, and the link is often blocked entirely by a planet being in the way. You cannot wait for an acknowledgment when an acknowledgment is twenty minutes away and the link might be down when it arrives.

The DTN answer is **store-and-forward**, also called "bundle" delivery. Instead of a live end-to-end connection, a message is wrapped into a self-contained **bundle** that carries everything needed to route and understand it. Each node along the way *stores* the bundle, possibly for a long time, and *forwards* it whenever it next gets a chance — whenever a link opens up, whenever it physically encounters another node. The message ratchets forward, hop by hop, with no requirement that a full path ever exists all at once.

Read that again, because it's the heart of the whole project: **the message moves forward in space and time without any continuous connection ever existing.** A note you write today might sit on your device for a day, hop to a friend's phone over local wifi tomorrow, ride in their pocket across town, and reach its destination next week — and the system considers that a *success*, not a failure.

The formal protocol here is **Bundle Protocol (BPv7)**, descended from the interplanetary work. You don't need to implement BPv7 to start, but knowing it exists — and that serious people solved this problem for literal spacecraft — keeps the project grounded in reality rather than feeling like invention.

## 3.2 Mesh networks: many small hops instead of one big link

Remember hop-by-hop routing from §2.3? A **mesh network** takes that idea and removes the assumption of fixed infrastructure. Instead of routers owned by an internet provider, *every device is also a relay.* Each node talks to whatever neighbors are in range, and messages hop neighbor-to-neighbor across the mesh. No cell tower, no internet provider, no central anything. If one node disappears, messages route around it. The network is made of its participants.

This is how you get communication in places with no infrastructure — wilderness, disaster zones, dense cities where the cell network is overloaded, anywhere the normal internet is absent or untrusted. It pairs naturally with store-and-forward: a mesh where nodes also hold messages for absent neighbors is a mesh that tolerates disconnection.

The most accessible real example is **Meshtastic** (more on it in Part 6): cheap radios that form a text-messaging mesh over many kilometers, running for days on a small battery, with no internet at all.

## 3.3 Gossip: how peers catch each other up

When two peers finally do meet — over wifi, over radio, whenever — how do they reconcile what each knows? The elegant answer is a **gossip protocol** (also called epidemic or anti-entropy protocols, because information spreads like a rumor or an infection).

The idea is delightfully simple: when two peers connect, they *gossip* — "here's what I know, what do you have that I don't?" — and exchange the difference. Each peer that learns something new will, in turn, pass it to the next peer it meets. Information spreads through the population by repeated pairwise contact, no central coordinator needed. Given enough chance encounters, everyone converges on the same knowledge. This is exactly how **Secure Scuttlebutt** (Part 6) builds a whole social network with no servers: your posts spread person-to-person as devices sync.

## 3.4 Sneakernet: the network made of human movement

The oldest and most unkillable network: **put the data on a physical thing and carry it.** A memory card, a USB stick, a hard drive in a backpack. It's called **sneakernet** (as in, the data travels at the speed of sneakers). It sounds like a joke until you do the math — a pocket full of SD cards moving across a city carries staggering amounts of data, and it works with *zero* live connectivity, through any blockade, across any outage.

For our system, sneakernet isn't a fallback — it's a *first-class transport.* If our information is packaged correctly (Part 4 explains how — content addressing makes this clean), then a note carried on a memory card and a note synced over wifi are *the same operation* as far as the system is concerned. **Kiwix** (Part 6) already moves entire offline copies of Wikipedia this way. Designing sneakernet in from the start is one of the most permacomputing-aligned, infrastructure-independent choices available.

---

# Part 4 — Agreeing on shared truth without a boss

We chose P2P, which means no central server declares "this is the current, true state." So when copies of information live on many devices and get changed independently, how do we ever reconcile them into a coherent whole? This is the deepest technical problem in the project, and it has two beautiful pieces.

## 4.1 Content addressing: naming things by *what they are*

Normal storage names things by **location**: "the file at `/home/me/notes.txt`," "the page at `example.com/article`." Location-based names have a fatal flaw for our purposes — the same content at two locations looks like two different things, and the same name can point to different content over time (the file gets edited; the web page changes). Location is unstable.

**Content addressing** names things by their content instead. You run the content through a **hash function** — a mathematical meat-grinder that takes any input and produces a short, fixed-length fingerprint (the "hash"). The key properties: the same input *always* produces the same fingerprint, and even a tiny change to the input produces a *completely different* fingerprint, and you essentially can't find two different inputs with the same fingerprint. So the fingerprint becomes a stable, universal name for that exact content.

This quietly solves an enormous number of our problems at once:

- **Same content is the same name, everywhere.** A note on your phone, your Pi, and a memory card all have the identical hash. The system knows instantly they're the same thing. No duplication, no confusion across devices.
- **Integrity is free.** Want to know if a file was tampered with? Re-hash it and compare. If the fingerprint matches, it's bit-for-bit the original. This is how you can trust data that traveled across untrusted devices and networks — you don't have to trust the *path*, only the *hash.* For an archive, this is the difference between "probably the document I had" and a verifiable yes/no.
- **Sync becomes trivial to describe.** "Do you have hash `abc123`? No? Here it is." Two peers reconcile by comparing lists of hashes and shipping whatever's missing. Whether that shipping happens over wifi, radio, or a carried SD card is irrelevant to the logic.

This is the model behind **Git** (every commit is a hash), **IPFS** (the InterPlanetary File System — content-addressed storage for the whole web), and **Perkeep** (content-addressed personal storage). Our substrate — the "filesystem" half of the project — is content-addressed at its core. This is non-negotiable, because every other resilience property leans on it.

## 4.2 CRDTs: letting everyone edit, then merging without a fight

Content addressing handles *immutable* things beautifully — a thing, once created, has a permanent name. But we also have things that *change*: a shared document, a set of annotations, the state of a shared world. Two people edit the same thing while both offline. They reconnect. Now what? One naive answer is "last edit wins," which silently throws away someone's work. Another is "make the human resolve every conflict," which is exhausting. There's a third, almost magical answer.

A **CRDT** — Conflict-free Replicated Data Type — is a specially designed data structure with a guarantee: **no matter what order the changes arrive in, and no matter who was disconnected when, every copy that has seen the same set of changes will end up *identical*, automatically, with no central coordinator.** The structure is built so that merging is always well-defined and never loses data. Two people typing in the same document while both offline will, on reconnection, see a merged result that includes both their work, deterministically.

The way it achieves this is by being clever about *how* changes are represented — instead of storing "the text is now X," it stores fine-grained operations with enough identity and ordering information that any two sets of operations can be combined commutatively (order doesn't matter) and idempotently (applying the same change twice is harmless). You don't need to implement one from scratch — mature libraries exist: **Automerge** and **Yjs** are the two best-known. But you *do* need to understand the guarantee they give you, because it's the thing that makes "edit anything, anywhere, offline, and it all reconciles" actually true rather than aspirational.

CRDTs are the precise technical meaning of "resilient continuity through disconnections." When you wrote that phrase, this is the machinery you were reaching for.

## 4.3 The honest tradeoff

CRDTs aren't free magic. Automatic merging means sometimes the merged result is *technically* consistent but *semantically* odd — two people independently rewrote the same sentence, and the merge interleaves both rewrites in a way no human would have chosen. Convergence guarantees the copies *match*; it doesn't guarantee they match something *sensible*. So real systems often combine CRDTs (for the convergence guarantee) with some UI for surfacing the rare genuinely-conflicting cases to a human. The design question "what should happen when two people edit the same thing offline" — last-write-wins, automatic CRDT merge, or human-surfaced conflict — is a real fork you'll have to choose per kind of data, and it's worth deciding deliberately rather than by default.

---

# Part 5 — Federation: the middle path between center and chaos

Pure client-server is too centralized for us. Pure P2P is wonderful but hard, and sometimes overkill. There's a celebrated middle design called **federation**, and it's worth understanding deeply because it's often the *right* amount of decentralization.

## 5.1 The idea, via the thing you already use

You already use a federated system every day: **email.** There's no single company that runs "email." There are many independent mail servers — your provider, mine, a university's, a self-hosted one in someone's closet — and they all speak a common protocol so they can hand messages to each other. You and I can email even though we're on completely different providers, because the *protocol* is shared even though the *servers* are independent. No one owns email. Anyone can run a server. If one provider vanishes, email itself is unharmed.

That's federation: **many independent servers ("instances"), each owned and run by different people, all speaking a common protocol, interoperating into one larger network — with no central owner.** It sits between the lonely-but-free P2P world (every device for itself) and the convenient-but-captive client-server world (one owner rules all). In federation, you pick (or run) a server you trust, and through it you reach everyone on every other server.

## 5.2 The modern federation protocols

- **ActivityPub** is the protocol behind the "fediverse" — **Mastodon** (federated social media), **PeerTube** (federated video), and a growing ecosystem. Independent instances, shared protocol, one interoperating network.
- **Matrix** is a federated protocol for real-time chat and messaging — think of it as "email for instant messaging," with independent servers and end-to-end encryption. It's especially relevant to us because it's designed around *eventual consistency* and syncing state across servers, which rhymes with our disconnection-tolerance goals.

## 5.3 Where federation fits *our* system

Federation gives us an optional middle layer. The base of our system is local-first and P2P — your devices hold your data and sync directly. But not every device can always reach every other device directly. A **federated layer** can act as helpful, *optional, replaceable* meeting points: small servers (which could be as humble as a Raspberry Pi in a community space) that hold and relay data for peers who can't currently reach each other, speaking a common protocol so any such server can be swapped for any other. Crucially — and this is the design discipline — these servers are *conveniences, not authorities.* Because the data is content-addressed and integrity-checked (Part 4), a relay server can pass your data along but can't secretly alter it, and if it disappears, another can take its place, or peers can fall back to direct sync and sneakernet. Federation, done this way, adds reach without reintroducing a master.

---

# Part 6 — The hardware, and the philosophy of choosing it

Up to now everything's been ideas. Ideas run on physical things. The choice of *which* physical things is where your permacomputing values stop being abstract and become a parts list.

## 6.1 The permacomputing ethic, briefly

**Permacomputing** is a small but serious movement (the name echoes permaculture) built around a few commitments: computing should be *durable* (built to last decades, not replaced yearly), *resourceful* (squeeze real use out of modest and "obsolete" hardware instead of demanding the newest chip), *low-power* (runnable off a small solar panel or a hand-crank, not a data center), and *resilient* (degrade gracefully, keep working when infrastructure doesn't). It's a direct rebuke to the disposable, ever-upgrading, cloud-dependent default. Our project is, in spirit, a permacomputing project — which is why "runs on obsolete devices" is a feature, not a limitation.

## 6.2 The hardware layers, simplest to most capable

**Microcontrollers** — the smallest computers. A microcontroller is a single chip with a tiny processor, a little memory, and pins to connect to the physical world. It doesn't run an operating system in the usual sense; it runs one program, directly. Think of the brains inside a thermostat or a key fob. They cost a few dollars, sip power, and run for ages. In our world, microcontrollers are what power the cheapest mesh nodes — they're the brains of a Meshtastic radio.

**Single-Board Computers (SBCs)** — a whole computer on one small board. The **Raspberry Pi** is the famous one; there are many others (Pine64, Orange Pi, etc.). These *do* run a real operating system (usually Linux), have real storage, can serve files, run databases, host a small federated server. An SBC is the natural home for a "node" in our system that does real work — holds a chunk of the archive, relays for neighbors, serves a reading interface. They're cheap, low-power enough to run off solar, and rugged.

**Radios — the LoRa family.** **LoRa** (Long Range) is a radio technology built for sending *small* amounts of data over *long* distances on *very little* power. Not fast — you wouldn't stream video — but you can send text many kilometers on a coin-cell's worth of energy, with no cell network, no internet, no infrastructure. LoRa is the physical layer that makes off-grid text meshes possible.

**Meshtastic** ties the last two together: it's open-source firmware (see Part 7) that turns cheap LoRa radio boards into a self-forming text-messaging mesh. Buy a few small boards, flash Meshtastic onto them, and you have an infrastructure-free text network spanning a town. It is the single most concrete, buy-it-today realization of "communication on low-power obsolete-friendly hardware with no internet," and it's already in your toolkit list. It's the obvious thing to physically hold and experiment with early.

**Dumb phones, e-ink devices, old laptops.** Part of the ethic is meeting people on the devices they actually have, especially the durable low-power ones. An e-ink reader sips power and is gentle to read on for long-form text (relevant to the annotation goal). An old laptop that "can't run modern software" runs a content-addressed note store and a sync client just fine. A feature phone can be a text endpoint on a mesh. Designing for these isn't charity — it's resilience. Hardware that's cheap and abundant is hardware that survives.

---

# Part 7 — Firmware: the layer most people never see

You asked about firmware specifically, and it's a genuinely under-explained layer, so here's the honest picture.

**Firmware is the software that lives *on* a piece of hardware and makes it be what it is** — the layer between raw silicon and the software you actually interact with. It's "firm" because, historically, it sat in the gray zone between *hard*ware (fixed) and *soft*ware (easily changed) — written into the device, not loaded fresh every time, but still updatable.

A few framings that make it click:

- On a **microcontroller** (like a Meshtastic radio), the firmware basically *is* the whole program. There's no operating system underneath running other apps — the firmware talks straight to the chip, manages the radio, handles the mesh logic. When you "flash Meshtastic onto a board," you're writing that firmware into the chip's memory, replacing whatever was there. This is the most direct, satisfying form of firmware: the device does exactly what the firmware says and nothing else.

- On an **SBC** like a Raspberry Pi, there's a layered situation. There's low-level firmware that brings the chip to life and knows how to start things up (analogous to the BIOS/UEFI in a PC — the very first code that runs and gets the machine ready to load an operating system). Then a full operating system (Linux) loads on top, and *your* software runs on that. So on an SBC, firmware is the foundation but not the whole story.

- The relationship to the **kernel** (the core of an operating system) is a common confusion: firmware gets the hardware to a state where an OS *can* run; the kernel is the heart of that OS, managing memory, processes, and access to hardware once it's running. Firmware is "wake up and prepare the body"; the kernel is "run the mind."

Why this matters for *us*: the low end of our hardware (mesh radios) is *all firmware* — building or customizing mesh behavior means working at the firmware level, often in C or C++, often with constrained memory and no comfortable operating system to lean on. The high end (SBCs) lets us work in ordinary software on top of Linux. Knowing which layer you're standing on tells you what tools and constraints you're dealing with. Your interest in learning C is directly relevant here: the firmware/low-level world is C's home turf, and the mesh layer is exactly where that knowledge pays off.

---

# Part 8 — The full software stack we'd actually build

Now we assemble everything into the layered architecture. Notice it's the same "stack of protocols, each ignorant of the others" idea from §2.2 — just our own unusual stack.

```
┌─────────────────────────────────────────────────────────┐
│  LAYER 4 — APPLICATION                                   │
│  Reading + annotation; the shared persistent space.      │
│  "What the human sees and does."                         │
├─────────────────────────────────────────────────────────┤
│  LAYER 3 — SYNC & MERGE                                  │
│  CRDTs (Automerge/Yjs) + gossip reconciliation.          │
│  "Everyone converges, no matter the order or delay."     │
├─────────────────────────────────────────────────────────┤
│  LAYER 2 — TRANSPORT (many, interchangeable)             │
│  Local wifi · LoRa mesh (Meshtastic) · Bluetooth ·       │
│  federated relay · sneakernet (SD/USB/QR).               │
│  "Move bytes between peers, by whatever means exist."    │
├─────────────────────────────────────────────────────────┤
│  LAYER 1 — SUBSTRATE (content-addressed store)           │
│  Hash-named, integrity-checked, location-independent.    │
│  "The same thing is the same thing, everywhere."         │
├─────────────────────────────────────────────────────────┤
│  LAYER 0 — HARDWARE + FIRMWARE                           │
│  SBCs, microcontrollers, radios, old/low-power devices.  │
│  "The durable physical body."                            │
└─────────────────────────────────────────────────────────┘
```

The discipline that keeps this buildable instead of overwhelming: **each layer is independently useful and independently testable, and you build them bottom-up, one transport at a time.** You do *not* build all of this before anything works. A working slice through layers 0–3 with *one* transport (say, local wifi) and the simplest possible application is a complete, real system you can hold and use. Everything else is addition, not prerequisite.

## 8.1 The annotation application, specifically

Annotation deserves its own treatment because it's the first real application and it has a famously tricky core problem: **anchoring.**

An annotation is a note attached to a *specific place* in a piece of content — this paragraph, this sentence, this page, this passage in a book. The hard question is: *how do you describe "this place" so the description survives?* If you anchor to a location ("character 4,182") and the document changes even slightly, the anchor now points at the wrong spot, or nowhere. This is the same instability that pushed us to content addressing in the first place, now showing up inside documents.

The mature answer (worked out by the web-annotation world, especially the project **Hypothes.is** and the **W3C Web Annotation Data Model**, an actual open standard for what an annotation *is*) is to anchor *robustly* and *redundantly*: describe the target by a combination of the surrounding text (a quote and its context — "find this string"), a structural position, and a positional hint, so that if one method fails after a change, the others can still locate the spot. Anchor to *content and context*, not just position. Combined with our content-addressed substrate, an annotation can name the exact immutable version of a document it was made against (by hash) *and* carry robust anchors so it can also be re-attached to a changed version. That's a genuinely strong design, and it falls naturally out of everything in Parts 4 and 8.

The annotations themselves are just more data in the system — content-addressed, synced via CRDTs, shareable over any transport, visible to a chosen group. "Share my margin notes on this book with my three friends, and have it work even if we're never online at the same time" becomes a straightforward consequence of the architecture rather than a special feature.

---

# Part 9 — The people and projects to learn from

You're not inventing this from nothing — you're composing from a rich existing tradition. These are the reference points worth studying, roughly grouped. Studying working systems is faster and more honest than studying theory alone.

**Local-first / the foundational essay.** The phrase "local-first software" comes from a 2019 essay out of **Ink & Switch** (a research lab; **Martin Kleppmann** is a key figure, along with others). It's the single best articulation of the *values and goals* of exactly what you're building — software where your data lives with you, works offline, syncs across devices, and survives the death of any company. Read this first; it names your North Star precisely. Kleppmann's book *Designing Data-Intensive Applications* is the deeper technical companion.

**Secure Scuttlebutt (SSB).** A fully peer-to-peer social network with *no servers at all* — posts spread device-to-device via gossip, and it works offline by design. The closest existing realization of "shared social state with no center." Study how it handles identity, gossip, and offline-first. (Associated with **Dominic Tarr** and a vibrant off-grid community, some of whom literally live on boats.)

**Devine Lu Linvega / 100 Rabbits / Uxn / Varvara.** This is the closest match to your *values and aesthetic* anywhere. A duo living on a sailboat, building tiny, durable, low-power software designed to run for decades on minimal hardware, off-grid. **Uxn** is a minuscule virtual machine that runs the same programs identically across wildly different devices — a phone, a Raspberry Pi, an old laptop, a browser — which is a profound answer to "runs on many device types." If you study one body of work for *taste* and *philosophy made concrete*, make it this one.

**Meshtastic.** The buy-it-and-flash-it realization of an off-grid LoRa text mesh. Your fastest path to physically holding the disconnection-tolerant idea. Already in your toolkit.

**Briar.** A messaging app designed for activists and journalists in connectivity-hostile or surveilled environments. Syncs over Tor, Bluetooth, and wifi-direct; works with no internet at all. Excellent study for the *transport-agnostic, hostile-conditions* end of the design.

**IPFS / Perkeep.** Content-addressed storage in practice. **IPFS** (InterPlanetary File System) is content addressing for the whole web; **Perkeep** is content-addressed *personal* storage — closer to your "filesystem for one person's stuff that lasts" goal. Study these for Layer 1.

**Automerge / Yjs.** The two mature CRDT libraries. You'll likely build Layer 3 on one of them. Study their docs and, better, build a tiny two-tab offline-merge demo.

**Matrix / ActivityPub.** The two living federation protocols. Study these for Layer 2's optional federated relays and for how real federated systems handle identity and eventual consistency.

**Hypothes.is / W3C Web Annotation Data Model.** The reference for the annotation application — especially the hard anchoring problem and a real open standard for representing annotations.

**Kiwix / Internet-in-a-Box.** Proof that whole libraries (Wikipedia, medical references, educational content) already travel and serve offline on modest hardware via sneakernet. Direct prior art for "places to hold info" in low-connectivity settings. Already in your toolkit.

---

# Part 10 — What to learn, in order

Derivation-first, building from foundations to the specific. This is a learning sequence, not a checklist to rush — each step makes the next legible.

**Foundations of how networks actually work.**
- Work through a solid networking primer to *really* understand the layered model, IP/TCP/UDP, routing, and DNS — not to memorize, but to be able to *derive* why each exists from the problem it solves. (*Computer Networking: A Top-Down Approach* by Kurose & Ross is the standard, and its "top-down" structure suits how you learn.)
- The payoff: every unusual choice in this project is a *deviation* from the normal stack, and you can only appreciate a deviation if you understand the default.

**Distributed systems fundamentals.**
- The core ideas: consistency, the reality that the network is unreliable, why there's no perfect "current global truth," eventual consistency. Kleppmann's *Designing Data-Intensive Applications* (Ch. 5, 7, 9) is the friendliest serious treatment.
- The payoff: this is the theory under CRDTs and federation. It's what lets you talk fluently about *why* offline-first is hard and how your design earns its guarantees.

**Content addressing and CRDTs, hands-on.**
- Read the **Ink & Switch local-first essay** for goals; skim **IPFS** and **Automerge/Yjs** docs for mechanism.
- Build the smallest possible thing: two browser tabs editing one document, merging via Yjs while "offline." When you can explain *why* it converges, you've crossed the most important conceptual threshold in the project.

**The low-level / firmware end (paired with your C learning).**
- Continue C, and connect it to the hardware end: get a Meshtastic radio or two, flash the firmware, send messages with no internet. Read enough of the firmware to see how the mesh logic works.
- The payoff: you'll understand Layer 0 from the inside, and the C work stops being abstract exercise and becomes the actual language of the mesh layer.

**Study the exemplars for taste and architecture.**
- Spend real time with **Uxn/100 Rabbits**, **Scuttlebutt**, and **Briar** — not to copy, but to internalize how people who share your values made the hard tradeoffs. This is where "ambitious but vague" turns into "ambitious and specific."

---

# Part 11 — The build roadmap

The cardinal rule, restated because it's the thing most likely to save the project: **do not build all the layers at once, and do not start at the application. Build the smallest end-to-end slice that proves the core thesis, then widen.** Each phase below is a *complete, usable system on its own* — never a dead-end prerequisite.

**Phase 0 — Prove the merge.** *(software only, no hardware, no networking)*
Two copies of a simple data structure (say, a list of notes) on one machine. Edit both independently. Merge them with a CRDT library and watch them converge. No transport, no hardware — just prove to yourself that the convergence guarantee is real and you understand it. This is the conceptual keystone; everything leans on it.

**Phase 1 — One thing, two devices, one transport, offline.**
Write a content-addressed note on one device (your laptop). Sync it to a second device (a Raspberry Pi) over *local wifi only* — no internet ever touches it. Add a different note on the Pi while disconnected; reconnect; watch them merge. This single phase proves Layers 1, 3, and one transport in Layer 2, plus real hardware in Layer 0. **When this works, you have a genuine local-first system that no one can take offline, because there was never an "online."** This is the real milestone — guard it; don't let scope creep past it before it's solid.

**Phase 2 — Add a second transport: sneakernet.**
Make "carry a note on an SD card from device A to device B" a first-class sync, identical in logic to the wifi sync. Because the substrate is content-addressed, this should be *easy* — and proving it's easy validates the whole architecture. Now your system tolerates total connectivity loss.

**Phase 3 — Add the radio mesh.**
Bring in Meshtastic hardware. Sync small pieces of data (or notifications of available data) across a LoRa mesh with no internet. This is where "runs on obsolete low-power hardware, off-grid" becomes physically true. Keep payloads tiny — LoRa is slow; use it to *announce and coordinate* sync, with bulk data moving over wifi or sneakernet when peers are close.

**Phase 4 — The annotation application.**
Now, on a proven substrate, build the reading-and-annotation layer: open a long-form document, attach robust-anchored notes to specific passages, share them with a small group, and have it all sync and survive disconnection via everything built in Phases 0–3. The hard part here is anchoring (Part 8.1), not the syncing — the syncing is already solved by the layers beneath.

**Phase 5 — Optional federated relays.**
Add small, replaceable relay servers (a Pi in a community space) speaking a common protocol, to extend reach for peers who can't meet directly — *as conveniences, never authorities*, with integrity guaranteed by content addressing so a relay can pass data but never forge it.

**Phase 6 — Widen the device frontier.**
Bring in the e-ink readers, the old laptops, the feature phones — the durable, abundant, "obsolete" hardware the whole project is *for.* Each new device class is an addition to a working system, not a rewrite.

The shape of the roadmap is the shape of the philosophy: **start with something small that already cannot be switched off, and make it reach further, one durable layer at a time.**

---

# Glossary

**ActivityPub** — A protocol for federated social applications (Mastodon, etc.); independent servers interoperating via a shared standard.

**Bundle Protocol (BPv7)** — A delay-tolerant networking protocol descended from interplanetary networking; wraps messages in self-contained "bundles" that move via store-and-forward.

**Client-server** — Network shape where a central server holds authoritative state and clients are windows onto it. Convenient, centralized, single point of failure.

**Content addressing** — Naming data by a hash of its content rather than by location, giving every piece of content a stable, universal, tamper-evident name.

**CRDT (Conflict-free Replicated Data Type)** — A data structure that guarantees all copies converge to an identical state after seeing the same changes, regardless of order or timing, with no central coordinator.

**Delay-Tolerant Networking (DTN)** — Networking designed for environments where continuous end-to-end connectivity can't be assumed; relies on store-and-forward.

**DNS (Domain Name System)** — The internet's phonebook, translating human names into IP addresses. A point of central control.

**Federation** — Many independent servers run by different people, all speaking a common protocol to interoperate into one network with no central owner (e.g. email).

**Firmware** — Software living on a device that makes it function, sitting between raw hardware and higher-level software; on small microcontrollers it's effectively the whole program.

**Gossip protocol** — A method where peers reconcile knowledge through repeated pairwise exchange, so information spreads through a population like a rumor.

**Hash function** — A function turning any input into a short fixed-length fingerprint; the basis of content addressing and integrity checking.

**IP address** — A network-layer address identifying a machine so routers can forward data toward it.

**Kernel** — The core of an operating system, managing memory, processes, and hardware access once the OS is running.

**LoRa (Long Range)** — A radio technology for sending small amounts of data over long distances on very little power; the physical basis of off-grid text meshes.

**Local-first** — A software philosophy where data lives primarily on your own devices, works offline, syncs across devices, and survives the death of any company.

**Matrix** — A federated protocol for real-time messaging, with independent servers and eventual consistency.

**Mesh network** — A network with no fixed infrastructure where every device also relays, so messages hop device-to-device.

**Microcontroller** — A tiny single-chip computer that typically runs one program directly with no operating system; the brains of small mesh radios.

**OSI / TCP-IP model** — Layered models of networking; the enduring idea is that a network is a stack of protocols, each ignorant of the others' internals.

**Peer-to-peer (P2P)** — Network shape with no privileged center; every device holds its own data and syncs directly with others. Resilient but harder to coordinate.

**Permacomputing** — A movement valuing durable, resourceful, low-power, resilient computing that squeezes long life out of modest and "obsolete" hardware.

**Protocol** — A set of rules both sides follow so a stream of signals becomes shared understanding. The fundamental building block of all networking.

**Router** — A machine that forwards data hop-by-hop toward its destination address, each knowing only the next step.

**SBC (Single-Board Computer)** — A whole computer on one small board (e.g. Raspberry Pi) running a real operating system; a natural home for working nodes.

**Sneakernet** — Moving data by physically carrying storage (SD cards, USB drives); an unkillable transport requiring zero live connectivity.

**Store-and-forward** — Holding a message and passing it on at the next opportunity, letting it move forward without any continuous end-to-end connection.

**Substrate** — In this document, the bottom data layer: the content-addressed store that holds everything.

**TCP / UDP** — Transport protocols. TCP is reliable, ordered, connection-based (and assumes both ends are simultaneously online). UDP is fast and best-effort.

**W3C Web Annotation Data Model** — An open standard defining what a web annotation is and how it targets content, including robust anchoring.
