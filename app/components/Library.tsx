import type { LibraryStore } from "../../core/store";
import { LibraryContext, notice } from "../state";
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
import { Present } from "./Present";

// Root: provides the store to everything below, and switches views on the route.
export function Library({ store }: { store: LibraryStore }) {
    const r = route.value;
    // the big screen is its own layout: no header, nothing to tap by accident
    if (r.view === "present") {
        return <LibraryContext.Provider value={store}><Present /></LibraryContext.Provider>;
    }
    return (
        <LibraryContext.Provider value={store}>
            <div class="library">
                <Header />
                {notice.value && (
                    <p class={`library__notice${notice.value.error ? " library__notice--error" : ""}`} role={notice.value.error ? "alert" : "status"}>
                        {notice.value.text}
                        <button class="library__notice-close" type="button" onClick={() => { notice.value = null; }}>Dismiss</button>
                    </p>
                )}
                <NowShowing />
                <main class="library__main">
                    {r.view === "gallery" && <Gallery />}
                    {r.view === "activity" && <Feed />}
                    {r.view === "collections" && <Collections />}
                    {r.view === "collection" && <Collection id={r.id} />}
                    {r.view === "document" && <SingleDocumentView id={r.id} />}
                    {r.view === "add" && <AddDocument />}
                    {r.view === "you" && <You />}
                    {r.view === "sync" && <SyncScreen />}
                </main>
            </div>
        </LibraryContext.Provider>
    );
}
