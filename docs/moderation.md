# Moderation, bans and takedowns

What the library's stewards and admins can do, and what each thing really does. The Moderate page (in the header, for stewards and admins) has it all; the Takedown page (linked at the bottom of every page) is for everyone.

## Taking something back

Every note, upload, detail and name can be taken back, by whoever wrote it or by a steward. It's one more kind of op, `redact`, with two levels:

| Level | What people see | What is erased |
|---|---|---|
| **Strike out** | It stays where it was, with who wrote it and when; its words are `***` | its words |
| **Remove** | It's gone | its words; for an upload, its details, its file and its picture |

- **At the library** the words are erased from the log file itself (its line is written again), not only hidden. A removed upload's file is deleted once nothing else points at it, and the same file can't be uploaded again.
- **On phones** the app erases its own copy as soon as it hears, and deletes a removed upload's files from the phone.
- **What can't be reached keeps its copy:** a phone that never connects again, a file someone saved with "Save my work" or an export, and a drop point's flash (until it is reset). A copy that comes back from an old phone is never written again.
- **Who may:** an account takes back its own things on any of its devices. A guest takes back its own from the same device on the same Wi-Fi address it wrote from (a guest's device id is not proof enough on its own). A steward takes back anything. Nothing is taken back over the radio: do it at the library.
- The old "hide" still works and is still honoured; the app now offers Delete, Strike out and Remove instead.

## Activity

Everything that reached the library, newest first, a page at a time: who (an account's name, or a guest's with "(Guest)"), what, on which document, when, the device, and the address it came from (`radio` for what came through a drop point). Stewards strike out and remove from here; admins ban.

Moderators see everything that reaches the library, private collections included. Notes kept "only me" never leave their phone, so nobody sees those.

## Bans

By device, by address, by account, or any of them together; in this library, or (the node admin) in every library. A banned browser gets nothing of the library and can add nothing; ops from a banned device are refused by radio too. An account that is banned is signed out everywhere.

The banned person sees the admins' message, if they wrote one, and the admin's contact details if the admin ticked "send your contact details" (written once, on Moderate → Contact). The Takedown page still works for them.

Admins can't be banned (so nobody locks the library's own people out), and nobody can ban the address they are on.

**Limits.** A device id lives in the phone's storage: clearing it makes a new guest. An address is the Wi-Fi's to give out: it changes, and on a shared network it can be several people. Use both, and accounts where it matters.

## Takedowns

The Takedown page says what can be taken down and what happens then, lists what a US DMCA notice (17 U.S.C. § 512(c)(3)) and counter-notice (§ 512(g)(3)) contain, and has a form. Requests go to `data/takedowns.jsonl`, and admins read them on Moderate → Requests. The page is general information, not legal advice; whoever runs the library should check what applies to them (in the US, the § 512 safe harbor needs a designated agent registered with the Copyright Office).

## Kept

Each person's Kept is private to them and to the library's admins until they share it.

## Files

`data/moderation.json` (bans and the contact), `data/takedowns.jsonl`, and per library `origins.jsonl` (where each op came from) and `taken-down.json` (files that may not come back). Keep them private.
