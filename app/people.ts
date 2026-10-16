// The directory (who is who, roles, settings) and signing in and out (W-D12).
import type { LibraryStore } from "../core/store";
import { LockedError, type Directory, type HttpTransport } from "../adapters/http-transport";
import { banned, directory, locked, missing, tell, viewer } from "./state";
import { libraryId } from "./library";

const KEY = "directory";

type Meta = { getMeta(k: string): Promise<string | undefined>, setMeta(k: string, v: string): Promise<void> };

// The directory this device kept: offline, it still knows who is who.
export async function keptDirectory(store: LibraryStore, storage: Meta) {
    try {
        const kept = await storage.getMeta(KEY);
        if (kept) apply(store, JSON.parse(kept) as Directory);
    } catch { /* asked for below */ }
}

// Ask the node, and again whenever it says the directory has changed.
export async function startDirectory(store: LibraryStore, transport: HttpTransport, storage: Meta) {
    // one fetch at a time; asking again while one is under way fetches once more after it
    let asking: Promise<void> | null = null;
    let again = false;
    const refresh = (): Promise<void> => {
        if (asking) { again = true; return asking; }
        asking = (async () => {
            try {
                do {
                    again = false;
                    const d = await transport.directory();
                    if (!d) return;
                    // a drop point says only whether this library is open here; who is who stays as the library said
                    if (d.droppoint) {
                        missing.value = d.library.id !== libraryId;
                        if (missing.value) return;
                        // a phone that has never been to the library knows only what the drop point says
                        if (!directory.value) directory.value = d;
                        locked.value = d.library.locked;
                        return;
                    }
                    // the node answered for another library: this one isn't there
                    missing.value = d.library.id !== libraryId;
                    if (missing.value) { directory.value = { ...d, library: { id: libraryId, name: libraryId, protected: false, locked: false } }; return; }
                    apply(store, d);
                    await storage.setMeta(KEY, JSON.stringify(d));
                    if (await settle(store, transport, d)) again = true;
                } while (again);
            } finally {
                asking = null;
            }
        })();
        return asking;
    };
    transport.onDirectory = revision => { if (revision !== directory.value?.revision) void refresh(); };
    reload = refresh;
    await refresh();
}

let reload: () => Promise<void> = async () => {};

// after signing in or out, unlocking, or changing a setting
export function refreshDirectory(): Promise<void> {
    return reload();
}

function apply(store: LibraryStore, d: Directory) {
    directory.value = d;
    locked.value = d.library.locked;
    banned.value = d.banned ?? null;
    // this device writes for its account only when the node says it is that account's
    const owner = d.devices?.[store.user];
    store.setPerson(owner && owner === d.me?.id ? owner : null);
}

// Signed in, but this device isn't the account's yet: make it so (a device can only be one
// person's, so one that is someone else's starts again with a new id). True: ask again.
async function settle(store: LibraryStore, transport: HttpTransport, d: Directory): Promise<boolean> {
    if (!d.me || d.devices?.[store.user] === d.me.id || d.library.locked) return false;
    if (d.devices?.[store.user]) {
        await store.renew();
        viewer.value = store.user;
    }
    const linked = await transport.link(store.user);
    if (linked === "full") { tell("This account is signed in on too many devices to add this one.", true); return false; }
    return true;
}

// Signing in links this device to the account. `keepGuestWork`: what this device wrote as
// a guest becomes the account's; otherwise the device starts again with a new id.
export async function signIn(store: LibraryStore, transport: HttpTransport, username: string, password: string, keepGuestWork: boolean) {
    if (!keepGuestWork) { await store.renew(); viewer.value = store.user; }
    const r = await transport.signIn(username, password, store.user);
    if (r.linked === "taken") { await store.renew(); viewer.value = store.user; await transport.link(store.user); }
    await reload();
}

export async function signUp(store: LibraryStore, transport: HttpTransport, fields: { username: string, name: string, password: string, code?: string }, keepGuestWork: boolean) {
    if (!keepGuestWork) { await store.renew(); viewer.value = store.user; }
    const r = await transport.signUp({ ...fields, device: store.user });
    if (r.linked === "taken") { await store.renew(); viewer.value = store.user; await transport.link(store.user); }
    await reload();
}

// The next person on this device doesn't write as you: it becomes a new device. What's
// still waiting to send goes when you sign in again.
export async function signOut(store: LibraryStore, transport: HttpTransport) {
    await transport.signOut();
    await store.renew();
    viewer.value = store.user;
    await reload();
}

// did this device write anything as a guest (that signing in could make the account's)?
export function guestWork(store: LibraryStore): number {
    return store.ops.filter(o => o.user === store.user && o.type !== "name-user").length;
}

export async function unlock(transport: HttpTransport, password: string) {
    await transport.unlock(password);
    await reload();
}

export function isLocked(e: unknown): boolean {
    return e instanceof LockedError;
}
