import { follow, presence, views } from "../state";
import { href, route } from "../route";

// Tells everyone what the big screen is on, and lets them go there or keep following it.
export function NowShowing() {
    const showing = presence.value.showing;
    if (!showing) return null;
    const doc = views.value.documents[showing.documentId];
    if (!doc) return null;
    const r = route.value;
    const here = r.view === "document" && r.id === showing.documentId;
    return (
        <aside class={`now-showing${here ? " now-showing--here" : ""}`} aria-label="On the screen">
            <p class="now-showing__text">
                <span class="now-showing__label">On the screen now</span>
                {here
                    ? <span class="now-showing__title">You're looking at it.</span>
                    : <a class="now-showing__title" href={href({ view: "document", id: showing.documentId })}>{doc.properties.title}</a>}
            </p>
            <label class="now-showing__follow">
                <input type="checkbox" checked={follow.value}
                    onChange={e => { follow.value = (e.currentTarget as HTMLInputElement).checked; }} />
                Follow the screen
            </label>
        </aside>
    );
}
