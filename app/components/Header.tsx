import { medium, nodeRole, pending, presence, query, syncState, views, viewer } from "../state";
import { MEDIUMS, displayName } from "../format";
import { href, route, type Route } from "../route";

const SYNC_TEXT = {
    starting: "Starting…",
    "no-node": "Not connected",
    syncing: "Syncing…",
    synced: "Up to date",
    offline: "Offline",
    paused: "Sync paused"
};

const LINKS: [Route["view"], string][] = [
    ["gallery", "Gallery"], ["activity", "Activity"], ["collections", "Collections"], ["add", "Add"], ["suggest", "Suggest"]
];

// The same header on every page: where you are, the gallery's controls, who is
// here, and whether your work has reached the library.
export function Header() {
    const v = views.value;
    const me = viewer.value;
    const current = route.value.view;
    const waiting = pending.value;
    const online = presence.value.online;
    const atDropPoint = nodeRole.value === "droppoint" && syncState.value === "synced";
    // only offer kinds the library actually holds
    const kinds = MEDIUMS.filter(([value]) => value && Object.values(v.documents).some(d => d.properties.type === value));

    const search = (e: Event) => {
        query.value = (e.currentTarget as HTMLInputElement).value;
        if (route.value.view !== "gallery") location.hash = href({ view: "gallery" });
    };

    return (
        <header class="header">
            <a class="header__brand" href={href({ view: "gallery" })}>
                <span class="header__title">OSL</span>
                <span class="header__subtitle"><i>developed for Maroon's Motherboard project</i></span>
            </a>

            <form class="header__controls" role="search" onSubmit={e => e.preventDefault()}>
                <label class="header__control">
                    <span class="header__control-label">Search the library</span>
                    <input class="header__search" type="search" placeholder="Search titles, people, notes"
                        value={query.value} onInput={search} />
                </label>
                <label class="header__control">
                    <span class="header__control-label">Kind</span>
                    <select class="header__kind" value={medium.value} onChange={e => {
                        medium.value = (e.currentTarget as HTMLSelectElement).value;
                        if (route.value.view !== "gallery") location.hash = href({ view: "gallery" });
                    }}>
                        <option value="all">All kinds</option>
                        {kinds.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                </label>
            </form>

            <nav class="header__nav" aria-label="Main">
                {LINKS.map(([view, label]) => (
                    <a class={`header__link${current === view ? " header__link--active" : ""}`} key={view}
                        href={href({ view } as Route)} aria-current={current === view ? "page" : undefined}>{label}</a>
                ))}
            </nav>

            <div class="header__status">
                <details class="header__online">
                    <summary class="header__online-summary">
                        <span class="header__dot" aria-hidden="true" />
                        {online.length} online
                    </summary>
                    <ul class="header__online-list">
                        {online.length === 0 && <li class="header__online-item">{atDropPoint ? "Nobody else is at this drop point." : "Nobody is connected to the library right now."}</li>}
                        {online.map(p => (
                            <li class="header__online-item" key={p.user}>
                                {displayName(p.user, v.names, me)}
                                {p.viewing && v.documents[p.viewing] && (
                                    <> · <a href={href({ view: "document", id: p.viewing })}>{v.documents[p.viewing].properties.title}</a></>
                                )}
                            </li>
                        ))}
                    </ul>
                </details>
                <a class={`header__sync header__sync--${syncState.value}`} href={href({ view: "sync" })} role="status">
                    {atDropPoint ? "At a drop point" : SYNC_TEXT[syncState.value]}
                    {waiting > 0 && <span class="header__pending"> · {waiting} waiting</span>}
                </a>
                <a class={`header__you${current === "you" ? " header__link--active" : ""}`} href={href({ view: "you" })}>
                    {displayName(me, v.names, me)}
                </a>
            </div>
        </header>
    );
}
