import { banned } from "../state";
import { href } from "../route";

// What a banned device sees instead of the library: the admins' message, and their
// contact details if they chose to send them.
export function BannedScreen() {
    const b = banned.value;
    if (!b) return null;
    return (
        <section class="banned" aria-labelledby="banned-title" role="alert">
            <p class="banned__label">Not allowed here</p>
            <h2 class="banned__title" id="banned-title">The people who look after this library have stopped this device from using it.</h2>
            {b.message && <blockquote class="banned__message">{b.message}</blockquote>}
            {b.contact && <p class="banned__contact"><span class="banned__contact-label">To talk to them</span> {b.contact}</p>}
            <p class="banned__text">What you wrote stays on this device. <a href={href({ view: "takedown" })}>Taking something down</a> still works from here.</p>
        </section>
    );
}
