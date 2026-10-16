import { useEffect, useRef, useState } from "preact/hooks";
import { views } from "../state";
import { href } from "../route";
import {
    STEP_SECONDS, clearQueue, clock, current, duration, enqueue, failed, inQueue, move, next, nowPlaying, play, playing,
    position, previous, queue, removeAt, seekTo, skip, toggle
} from "../player";

// Drawn, not emoji: some phones turn ⏸ and ⏵ into coloured pictures.
const Icon = ({ name }: { name: "play" | "pause" | "back" | "forward" | "prev" | "next" | "queue" }) => {
    const paths = {
        play: "M7 4.5v15l12-7.5z",
        pause: "M6 4.5h4v15H6zM14 4.5h4v15h-4z",
        prev: "M6 5h2v14H6zM20 5v14L9 12z",
        next: "M16 5h2v14h-2zM4 5v14l11-7z",
        queue: "M3 6h13v2H3zM3 11h13v2H3zM3 16h9v2H3zM18 13v6l4-3z",
        back: "M12.5 5a7 7 0 1 1-6.9 8.2h2.1A5 5 0 1 0 12.5 7v3L8 6l4.5-4z",
        forward: "M11.5 5a7 7 0 1 0 6.9 8.2h-2.1A5 5 0 1 1 11.5 7v3L16 6l-4.5-4z"
    };
    return <svg class="icon" viewBox="0 0 24 24" aria-hidden="true"><path d={paths[name]} /></svg>;
};

// The thin player along the bottom of every page, while anything is queued.
export function AudioBar() {
    const [open, setOpen] = useState(false);
    const panel = useRef<HTMLDivElement>(null);
    const bar = useRef<HTMLDivElement>(null);
    const shown = queue.value.length > 0;

    // the notes dock and the full-screen reader sit above the bar: they read its height
    useEffect(() => {
        const el = bar.current;
        if (!shown || !el) return;
        const root = document.documentElement.style;
        const ro = new ResizeObserver(() => root.setProperty("--audio-bar", `${el.offsetHeight}px`));
        ro.observe(el);
        return () => { ro.disconnect(); root.removeProperty("--audio-bar"); };
    }, [shown]);
    const v = views.value;
    const id = nowPlaying.value;
    const doc = id ? v.documents[id] : undefined;
    const total = duration.value;

    // the queue closes with Escape, as a flyout should
    useEffect(() => {
        if (!open) return;
        const key = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
        addEventListener("keydown", key);
        panel.current?.focus();
        return () => removeEventListener("keydown", key);
    }, [open]);

    if (!shown) return null;
    return (
        <div class="audio-bar" role="region" aria-label="Audio player" ref={bar}>
            {open && (
                <div class="audio-bar__queue" ref={panel} tabIndex={-1} role="dialog" aria-label="Queue">
                    <div class="audio-bar__queue-head">
                        <h2 class="audio-bar__queue-title">Queue</h2>
                        <button class="audio-bar__text-button" type="button" onClick={() => { clearQueue(); setOpen(false); }}>Clear</button>
                        <button class="audio-bar__text-button" type="button" onClick={() => setOpen(false)}>Close</button>
                    </div>
                    <ol class="audio-bar__queue-list">
                        {queue.value.map((qid, i) => {
                            const d = v.documents[qid];
                            const here = i === current.value;
                            return (
                                <li class={`audio-bar__queue-item${here ? " audio-bar__queue-item--current" : ""}`} key={qid}>
                                    <button class="audio-bar__queue-play" type="button" onClick={() => play(qid)} aria-current={here ? "true" : undefined}>
                                        <span class="audio-bar__queue-name">{d?.properties.title ?? "Not in this library"}</span>
                                        {d?.properties.author && <span class="audio-bar__queue-author">{d.properties.author}</span>}
                                    </button>
                                    <span class="audio-bar__queue-tools">
                                        <button class="audio-bar__small" type="button" disabled={i === 0} onClick={() => move(i, -1)} aria-label={`Move ${d?.properties.title ?? ""} up`}>↑</button>
                                        <button class="audio-bar__small" type="button" disabled={i === queue.value.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${d?.properties.title ?? ""} down`}>↓</button>
                                        <button class="audio-bar__small" type="button" onClick={() => removeAt(i)} aria-label={`Remove ${d?.properties.title ?? ""} from the queue`}>×</button>
                                    </span>
                                </li>
                            );
                        })}
                    </ol>
                </div>
            )}
            {/* along the top edge of the bar: a thin line to look at, a taller strip to drag */}
            <input class="audio-bar__seek" type="range" min={0} max={total || 0} step={1} value={Math.min(position.value, total || 0)}
                disabled={!total} aria-label="Position" aria-valuetext={`${clock(position.value)} of ${clock(total)}`}
                style={{ "--done": total ? `${(100 * position.value) / total}%` : "0%" }}
                onInput={e => seekTo(Number((e.currentTarget as HTMLInputElement).value))} />
            <div class="audio-bar__main">
                <div class="audio-bar__buttons">
                    <button class="audio-bar__button audio-bar__button--wide-only" type="button" onClick={previous} aria-label="Previous"><Icon name="prev" /></button>
                    <button class="audio-bar__button" type="button" onClick={() => skip(-STEP_SECONDS)} aria-label={`Back ${STEP_SECONDS} seconds`}>
                        <Icon name="back" /><span class="audio-bar__step">{STEP_SECONDS}</span>
                    </button>
                    <button class="audio-bar__button audio-bar__button--play" type="button" onClick={toggle} aria-label={playing.value ? "Pause" : "Play"}>
                        <Icon name={playing.value ? "pause" : "play"} />
                    </button>
                    <button class="audio-bar__button" type="button" onClick={() => skip(STEP_SECONDS)} aria-label={`Forward ${STEP_SECONDS} seconds`}>
                        <Icon name="forward" /><span class="audio-bar__step">{STEP_SECONDS}</span>
                    </button>
                    <button class="audio-bar__button audio-bar__button--wide-only" type="button" onClick={() => next()} disabled={current.value + 1 >= queue.value.length} aria-label="Next"><Icon name="next" /></button>
                </div>
                <div class="audio-bar__now">
                    {doc
                        ? <a class="audio-bar__title" href={href({ view: "document", id: id! })}>{doc.properties.title}</a>
                        : <span class="audio-bar__title">{queue.value.length} queued</span>}
                    {failed.value
                        ? <span class="audio-bar__time audio-bar__time--failed">{failed.value}</span>
                        : <span class="audio-bar__time">{clock(position.value)}{total ? ` / ${clock(total)}` : ""}</span>}
                </div>
                <button class="audio-bar__button audio-bar__button--queue" type="button" aria-expanded={open} onClick={() => setOpen(!open)}>
                    <Icon name="queue" /><span class="audio-bar__count">{queue.value.length}</span>
                    <span class="audio-bar__label">Queue</span>
                </button>
            </div>
        </div>
    );
}

// Play and Queue for one recording: on a gallery card (without opening it) and in the reader.
export function AudioButtons({ id, large = false }: { id: string, large?: boolean }) {
    const here = nowPlaying.value === id;
    const queued = inQueue(id);
    queue.value;   // re-render when the queue changes
    return (
        <span class={`audio-buttons${large ? " audio-buttons--large" : ""}`}>
            <button class="audio-buttons__play" type="button" onClick={e => { e.preventDefault(); here ? toggle() : void play(id); }}
                aria-label={here && playing.value ? "Pause" : "Play"}>
                <Icon name={here && playing.value ? "pause" : "play"} />
                <span>{here && playing.value ? "Pause" : here ? "Resume" : "Play"}</span>
            </button>
            <button class="audio-buttons__queue" type="button" disabled={queued} onClick={e => { e.preventDefault(); enqueue(id); }}>
                {queued ? "In the queue" : "Add to queue"}
            </button>
        </span>
    );
}
