import type { LibraryStore } from "../../core/store";
import { useEffect } from "preact/hooks";
import { LibraryContext, banned, locked, missing, nodeRole, notice, signedOut, syncState, useTransport } from "../state";
import { route } from "../route";
import { Header } from "./Header";
import { NowShowing } from "./NowShowing";
import { Gallery } from "./Gallery";
import { Feed } from "./Feed";
import { Collections } from "./Collections";
import { Collection } from "./Collection";
import { SingleDocumentView } from "./SingleDocumentView";
import { AddDocument } from "./AddDocument";
import { You } from "./You";
import { SyncScreen } from "./SyncScreen";
import { DropPoints } from "./DropPoints";
import { Suggest, Suggestions, sendWaitingSuggestions } from "./Suggest";
import { Present } from "./Present";
import { AudioBar } from "./AudioBar";
import { LockScreen } from "./LockScreen";
import { Account } from "./Account";
import { Libraries } from "./Libraries";
import { Manage } from "./Manage";
import { Moderate } from "./Moderate";
import { Takedown } from "./Takedown";
import { BannedScreen } from "./BannedScreen";
import { href } from "../route";
import { queue } from "../player";

// Root: provides the store to everything below, and switches views on the route.
export function Library({ store }: { store: LibraryStore }) {
    const r = route.value;
    const transport = useTransport();
    // suggestions written away from the library go to the developer once it's in reach
    const atLibrary = nodeRole.value === "library" && syncState.value === "synced";
    useEffect(() => { if (atLibrary) void sendWaitingSuggestions(s => transport.suggest(s)); }, [atLibrary]);
    // a protected library shows nothing of itself until it's open; signing in and the
    // other libraries are still there
    const shut = (locked.value || missing.value || !!banned.value) && r.view !== "takedown" && r.view !== "account" && r.view !== "libraries" && r.view !== "you" && r.view !== "suggest";
    // the big screen is its own layout: no header, nothing to tap by accident
    if (r.view === "present" && !shut) {
        return <LibraryContext.Provider value={store}><Present /></LibraryContext.Provider>;
    }
    return (
        <LibraryContext.Provider value={store}>
            <div class={`library${queue.value.length ? " library--player" : ""}`}>
                <Header />
                {notice.value && (
                    <p class={`library__notice${notice.value.error ? " library__notice--error" : ""}`} role={notice.value.error ? "alert" : "status"}>
                        {notice.value.text}
                        <button class="library__notice-close" type="button" onClick={() => { notice.value = null; }}>Dismiss</button>
                    </p>
                )}
                {missing.value && (
                    <p class="library__notice library__notice--error" role="alert">
                        There's no library by this name on this node (it may have been deleted). What this device kept of it is still here; the libraries the node has are below.
                    </p>
                )}
                {signedOut.value && r.view !== "account" && (
                    <p class="library__notice library__notice--error" role="status">
                        This device was signed in to an account that isn't signed in now. What it has waiting stays here until you <a href={href({ view: "account" })}>sign in again</a>.
                    </p>
                )}
                {!shut && <NowShowing />}
                <main class="library__main">
                    {shut ? (banned.value ? <BannedScreen /> : missing.value ? <Libraries /> : <LockScreen />) : <>
                    {r.view === "gallery" && <Gallery />}
                    {r.view === "activity" && <Feed />}
                    {r.view === "collections" && <Collections />}
                    {r.view === "collection" && <Collection id={r.id} />}
                    {r.view === "document" && <SingleDocumentView id={r.id} />}
                    {r.view === "add" && <AddDocument />}
                    {r.view === "you" && <You />}
                    {r.view === "sync" && <SyncScreen />}
                    {r.view === "droppoints" && <DropPoints />}
                    {r.view === "suggest" && <Suggest />}
                    {r.view === "suggestions" && <Suggestions />}
                    {r.view === "manage" && <Manage />}
                    {r.view === "moderate" && <Moderate />}
                    </>}
                    {r.view === "takedown" && <Takedown />}
                    {r.view === "account" && <Account />}
                    {r.view === "libraries" && <Libraries />}
                </main>
                <footer class="library__foot">
                    <a href={href({ view: "takedown" })}>Taking something down</a>
                    <a href={href({ view: "suggest" })}>Suggest</a>
                </footer>
                <AudioBar />
            </div>
        </LibraryContext.Provider>
    );
}
