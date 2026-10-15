import type { Op } from "../../core/types";
import { lastSync, nodeRole, paused, pending, presence, relayed, syncState, useLibrary, views, viewer } from "../state";
import { when } from "../format";
import { href } from "../route";
import { syncNow } from "../sync";

const STATE_TEXT = {
    starting: "Starting up.",
    "no-node": "This device can't reach the library. Your work is saved here and will send when it can.",
    syncing: "Talking to the library…",
    synced: "Everything here has reached the library.",
    offline: "This device is offline. Your work is saved here and will send when you're back.",
    paused: "Syncing is paused. Your work stays on this device until you resume.",
    droppoint: "Handed in at a drop point. From here it goes on to the library by radio."
};

function summary(op: Op, title: (id: string) => string): string {
    switch (op.type) {
        case "document": return `Added “${op.properties.title}”`;
        case "annotation": return `Note on “${title(op.target)}”: ${op.body.slice(0, 60)}${op.body.length > 60 ? "…" : ""}`;
        case "describe": return `${op.field} of “${title(op.target)}”`;
        case "add-to-collection": return `Kept “${title(op.documentId)}”`;
        case "remove-from-collection": return `Removed “${title(op.documentId)}” from a collection`;
        case "name-collection": return `Named a collection “${op.name}”`;
        case "name-user": return `Set your name to ${op.name}`;
        case "hide": return "Hid a contribution";
    }
}

// Where your work is: on this device, or at the library. People manage syncing
// from here instead of from a separate app.
export function SyncScreen() {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    pending.value;      // re-render when the outbox changes
    relayed.value;
    const byId = new Map(store.ops.map(o => [o.id, o]));
    const waiting = store.outbox.map(id => byId.get(id)).filter((o): o is Op => !!o);
    const onTheWay = store.relayed.map(id => byId.get(id)).filter((o): o is Op => !!o);
    const atDropPoint = nodeRole.value === "droppoint";
    const mine = store.ops.filter(o => o.user === me).length;
    const title = (id: string) => v.documents[id]?.properties.title ?? "a document";
    // "synced" describes the last exchange; with notes written since, they're on their way
    const state = syncState.value === "synced" && waiting.length ? "syncing"
        : syncState.value === "synced" && atDropPoint ? "droppoint" : syncState.value;

    return (
        <section class="sync-screen">
            <h2 class="sync-screen__title">Sync</h2>
            <p class={`sync-screen__state sync-screen__state--${state}`} role="status">{STATE_TEXT[state]}</p>
            <p class="sync-screen__last">
                {lastSync.value ? <>Last reached the library <time dateTime={lastSync.value}>{when(lastSync.value)}</time>.</> : "Hasn't reached the library since this page opened."}
            </p>

            <div class="sync-screen__actions">
                <button class="sync-screen__button" type="button" disabled={paused.value} onClick={syncNow}>Sync now</button>
                <button class="sync-screen__button sync-screen__button--quiet" type="button" aria-pressed={paused.value}
                    onClick={() => { paused.value = !paused.value; }}>{paused.value ? "Resume syncing" : "Pause syncing"}</button>
            </div>

            <ol class="sync-screen__route">
                <li class="sync-screen__stop sync-screen__stop--here">
                    <span class="sync-screen__stop-name">This device</span>
                    <span class="sync-screen__stop-count">{waiting.length} waiting to send</span>
                </li>
                <li class={`sync-screen__stop${atDropPoint && syncState.value === "synced" ? " sync-screen__stop--reached" : ""}${!atDropPoint && !onTheWay.length ? " sync-screen__stop--off" : ""}`}>
                    <span class="sync-screen__stop-name">Drop point</span>
                    <span class="sync-screen__stop-count">{onTheWay.length} on the way by radio</span>
                </li>
                <li class={`sync-screen__stop${!atDropPoint && syncState.value === "synced" ? " sync-screen__stop--reached" : ""}`}>
                    <span class="sync-screen__stop-name">The library</span>
                    <span class="sync-screen__stop-count">{atDropPoint ? "out of reach from here" : `${presence.value.online.length} online`}</span>
                </li>
            </ol>

            <section class="sync-screen__section">
                <h3 class="sync-screen__heading">Waiting to send</h3>
                {waiting.length === 0
                    ? <p class="sync-screen__text">Nothing is waiting.</p>
                    : <ul class="sync-screen__list">{waiting.map(op => <li class="sync-screen__item" key={op.id}>{summary(op, title)}</li>)}</ul>}
                {store.mediaOutbox.length > 0 && <p class="sync-screen__text">
                    {store.mediaOutbox.length} photo{store.mediaOutbox.length === 1 ? "" : "s"} still to upload
                    {atDropPoint ? ": drop points don't keep files, so they go when you're at the library." : "."}
                </p>}
            </section>

            {onTheWay.length > 0 && (
                <section class="sync-screen__section">
                    <h3 class="sync-screen__heading">At a drop point, on the way to the library</h3>
                    <p class="sync-screen__text">These have left your phone. Each one drops off this list when you next sync after the library has it, here or at the library.</p>
                    <ul class="sync-screen__list">{onTheWay.map(op => <li class="sync-screen__item" key={op.id}>{summary(op, title)}</li>)}</ul>
                </section>
            )}

            <section class="sync-screen__section">
                <h3 class="sync-screen__heading">On this device</h3>
                <dl class="sync-screen__facts">
                    <dt>Your contributions</dt><dd>{mine}</dd>
                    <dt>Everything held here</dt><dd>{store.ops.length} entries</dd>
                    <dt>Conflicts</dt><dd>{store.conflicts.length}</dd>
                    <dt>Rejected as invalid</dt><dd>{store.rejected.length}</dd>
                    <dt>Can work offline</dt><dd>{isSecureContext ? "yes" : "no — this address isn't secure (http)"}</dd>
                </dl>
                <p class="sync-screen__text">
                    No connection at all? <a href={href({ view: "you" })}>Save your work as a file</a> and hand it in.
                </p>
            </section>
        </section>
    );
}
