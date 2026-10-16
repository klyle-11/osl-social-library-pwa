# Libraries, accounts and who may do what (W-D12)

One node (the Pi) can hold several libraries. People can use any of them as guests, or sign in with an account they keep for the whole node. What someone may do in a library comes from their roles there. This file is the design; the README's decisions list has the short form.

## Libraries

- **Several per node.** Each has its own op log, cursor and presence, so its notes and collections never mix with another's. The library that was there before is `main`: its log stays at `data/ops.jsonl`, so nothing moves. Others live in `data/libraries/<id>/`.
- **Files are held once.** Uploads stay in `data/media/` by their hash. A file is served to someone who may open at least one library that has a document with that hash.
- **Choosing one.** The page's address says which: `?library=poetry`. Without it, a device opens the library it used last (`main` the first time). Each library has its own storage on the phone (IndexedDB `osl` for `main`, `osl-lib-<id>` for the others), so switching is a reload, not a merge. The app, the service worker and the cache are shared.
- **Asking the node.** The main library's API is where it always was (`api/ops`); another library's is under `api/l/<id>/` (`?library=<id>` works too). A drop point that doesn't carry that library doesn't know the path and answers 404, so a phone in another library never hands its notes to the main library's inbox, and never takes the main library's notes into its own.
- **Made by the node admin.** An id (lowercase letters, digits and dashes) and a name; a password is optional, then or later. A deleted library's id is never used again: phones may still hold its ops under that id.

## Password protection

- A protected library asks for its password before it shows anything: its ops, its files, who is in it, its export. Members (anyone with a role there) and the node admin get in without it.
- The password is stored as PBKDF2-SHA256 with its salt and iteration count, so a drop point can check it too (W-D12, drop points).
- Entering it unlocks the library for that browser's session. Changing the password locks every session out again.
- A phone that opened the library keeps its copy. Changing the password stops new ops reaching it; it does not reach into phones.

## Accounts

- **Optional.** Without one, a person is a guest: their name shows with "(Guest)". An account's name shows without it.
- **One per node** (username, name, password), roles per library.
- **Passwords:** scrypt (N = 16384, r = 8, p = 1), with a salt, in `data/accounts.json`. Five wrong tries from one address wait a minute.
- **The first account is the node admin.** Making it needs the pairing code on the node's own screen, so the first phone on the Wi-Fi can't take the node. After that anyone can make an account, unless the node admin turns that off.
- **Sessions** are a cookie (`HttpOnly`, `SameSite=Lax`, `Secure` on https), kept in `data/sessions.json` as hashes. The browser sends it with every request, images and audio included, which is what lets a protected library's files be checked.

## Who wrote an op

Ops keep their device ids (`d-7q2kx9ma:12`): the op format, the merge and the drop point don't change. The node links each device to the account signed in on it, and every device gets the links (the "directory"). A person is their account if their device is linked, otherwise the device itself.

- Signing in links this device. If it already wrote things as a guest, the person chooses: keep them as theirs, or start fresh (a new device id).
- Signing out gives the device a new id, so the next person on it doesn't write as them.
- What was owned by a device is owned by its account: documents, collections, "Kept". Two devices of one account share one Kept.
- **The node checks the author.** An op from a device linked to an account is taken over http only from that account's session. Guests' ops are taken as before.
- **Known gap:** over the radio the library takes a drop point's word for who wrote an op. Signing ops per device would close it; it is in the parking lot.

## Roles (per library)

| Role | May |
|---|---|
| node admin | everything everywhere; makes and deletes libraries; sets watch folders; manages accounts |
| admin | this library's settings: name, password, who uploads, people's roles, groups. And everything a steward may |
| steward | hide anyone's contributions; change any document's details, who may edit them, and its prompts |
| presenter | show documents on the big screen (a device paired with the code still may too) |
| digitizer | upload as the digitization station: photos at full size (as does the paired station) |
| uploader | add documents when the library's upload setting names uploaders |
| member | open the library when it is protected, without the password |

Any role includes member. The node admin is admin of every library.

## Groups

Per library, made by its admins: a name and a list of accounts. Collections can be shared with groups.

## Who may add documents

Each library says who may add documents and upload files, as any combination of: **anyone** (guests too), **anyone signed in**, **members**, **uploaders**, **digitizers**, **presenters**. Admins and stewards always may. `main` starts as "anyone", as before. The node enforces it on uploads and on document ops (from the radio too); the app hides Add from people who may not.

## Watch folder

The node admin can give a library a folder on the node. New files in it become documents: hashed and copied into `data/media/` (a copy-on-write clone where the disk supports it), titled from the file name, added by "the library". Scanned at start, when the folder changes, and every minute. Files still being written, hidden files and partial downloads are left until they settle. A file taken out of the folder stays in the library.

## Collections: who may see and who may add

The owner sets both, any time:

- **See:** everyone (the default), only them, or chosen people and groups.
- **Add:** only them (the default), everyone, or chosen people and groups. Whoever added a document may take it out again; the owner may take out anything.

They are one more kind of op, `collection-access`, latest wins, set only by the owner. As with who may edit details, the setting that counts is the one standing when the add was made.

Sharing with a person needs them to have an account: a guest's device id is not proof of anything.

**Private means private at the node too.** A collection that isn't for everyone is only sent to the people it's for: the node leaves its ops out of everyone else's sync. When someone gains access (shared with them, added to a group, signed in), the node sends them the collection's earlier ops on their next sync. Taking someone off stops new ops; it can't take back what their phone has.

Restricted collections do not go out by radio; they are at the library.

## Drop points

Drop points carry protected libraries too. A drop point holds each library it carries separately, and asks for the library's password before handing out its ops (it checks it against the same PBKDF2 hash, sent to it by radio). Accounts stay at the library: at a drop point everyone is a guest, and a protected library opens with its password only.

**Risk, accepted:** a drop point's flash holds the libraries' ops and the password hashes in the clear. Anyone who takes the board can read them, and try passwords against the hash at their own pace. A drop point should carry a protected library only if that is acceptable for that library.

## What is not here

- Signed ops (see "Known gap").
- Accounts at drop points.
- Removing what a phone already holds.
