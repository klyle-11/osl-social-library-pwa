import { useEffect, useState } from "preact/hooks";
import type { DropPointInfo, DropPointsInfo, Signal } from "../../adapters/http-transport";
import { attempt, tell, tokens, useTransport } from "../state";
import { when } from "../format";

// How well a radio frame was heard, in words: SNR decides at our settings (SF9),
// where the radio can still decode down to about -12 dB.
function signalWords(s: Signal | null): string {
    if (!s) return "not heard yet";
    const word = s.snr >= 5 ? "strong" : s.snr >= 0 ? "good" : s.snr >= -7 ? "weak" : "barely";
    return `${word} (${Math.round(s.rssi)} dBm, SNR ${s.snr.toFixed(1)})`;
}

function duration(seconds: number): string {
    if (seconds < 60) return "under a minute";
    if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)} h ${Math.round((seconds % 3600) / 60)} min`;
    return `${Math.floor(seconds / 86400)} days`;
}

const clock = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "2-digit", minute: "2-digit" });

// The library and every drop point it has heard: which are connected, and how they're doing.
// Drop points say they're there every few minutes by radio; the library keeps the list.
export function DropPoints() {
    const transport = useTransport();
    const [info, setInfo] = useState<DropPointsInfo | "elsewhere" | null | undefined>(undefined);
    const presenter = tokens.value.presenter;

    useEffect(() => {
        let live = true;
        const load = async () => { const r = await transport.dropPoints(); if (live) setInfo(r); };
        void load();
        const timer = setInterval(load, 5000);
        return () => { live = false; clearInterval(timer); };
    }, [transport]);

    return (
        <section class="drop-points">
            <h2 class="drop-points__title">Drop points</h2>
            <p class="drop-points__intro">
                Places away from the library where people hand in their notes; the notes come here by radio.
                Each drop point says it's there every few minutes.
            </p>
            {info === undefined && <p class="drop-points__text">Asking the library…</p>}
            {info === null && <p class="drop-points__text">The library can't be reached from here right now.</p>}
            {info === "elsewhere" && <p class="drop-points__text">You're at a drop point. The list of drop points is kept at the library.</p>}
            {info && info !== "elsewhere" && (
                <>
                    <Library info={info.library} />
                    {info.droppoints.length === 0
                        ? <p class="drop-points__text">No drop point has been heard yet. One in range shows up here within a minute of being switched on.</p>
                        : <ol class="drop-points__list">
                            {info.droppoints.map(p => <DropPointRow key={p.id} point={p} canForget={!!presenter} onForget={() => attempt(async () => {
                                await transport.forgetDropPoint(presenter!, p.id);
                                tell(`${p.name} is off the list. It comes back if it's heard again.`);
                                setInfo(await transport.dropPoints());
                            })} />)}
                        </ol>}
                </>
            )}
        </section>
    );
}

function Library({ info }: { info: DropPointsInfo["library"] }) {
    const r = info.radio;
    const state = !r ? "No radio. Start the node with RADIO_PORT set to the modem's port to hear drop points."
        : !r.connected ? `The radio modem hasn't answered${r.lastHeard ? ` since ${clock(r.lastHeard)}` : " yet"}. Check its USB cable.`
        : r.working === false ? "The modem is connected but its radio didn't start (check its pins)."
        : `Radio connected on ${r.port}.`;
    return (
        <article class={`drop-point drop-point--library drop-point--${r?.connected && r.working !== false ? "connected" : "not-heard"}`}>
            <h3 class="drop-point__name">The library <span class="drop-point__id">here</span></h3>
            <p class="drop-point__state">{state}</p>
            <dl class="drop-point__facts">
                <dt>Phones here now</dt><dd>{info.phones}</dd>
                {r && <><dt>Waiting to go out by radio</dt><dd>{r.waitingToSend}</dd></>}
                <dt>App version</dt><dd>{info.app || "unknown"}</dd>
            </dl>
        </article>
    );
}

function DropPointRow({ point: p, canForget, onForget }: { point: DropPointInfo, canForget: boolean, onForget: () => void }) {
    const connected = p.state === "connected";
    return (
        <li class={`drop-point drop-point--${p.state}`}>
            <h3 class="drop-point__name">{p.name} <span class="drop-point__id">{p.id}</span></h3>
            <p class="drop-point__state" role="status">
                <span class="drop-point__dot" aria-hidden="true" />
                {connected ? `Connected · heard ${when(p.lastHeard)}`
                    : `Not heard since ${clock(p.lastHeard)}${Date.now() - Date.parse(p.lastHeard) >= 60_000 ? ` (${when(p.lastHeard)})` : ""}`}
            </p>
            {!connected && <p class="drop-point__note">As it was when last heard:</p>}
            <dl class="drop-point__facts">
                <dt>Notes waiting to cross</dt><dd>{p.waiting}</dd>
                <dt>Phones there</dt><dd>{p.phones}</dd>
                <dt>Heard at the library</dt><dd>{signalWords(p.atLibrary)}</dd>
                <dt>Hears the library</dt><dd>{signalWords(p.atDropPoint)}</dd>
                <dt>Free space</dt><dd>{Math.round(p.flashFree / 1024)} KB</dd>
                <dt>App</dt><dd class={p.sameApp === false ? "drop-point__warn" : undefined}>
                    {p.sameApp === false ? `Not the library's (${p.app || "none"}). Flash it with this build: npm run build:firmware, then uploadfs.`
                        : p.sameApp ? "Same as the library" : p.app || "unknown"}
                </dd>
                {connected && <><dt>Running for</dt><dd>{duration(p.up)}</dd></>}
                <dt>First heard</dt><dd>{new Date(p.firstSeen).toLocaleDateString()}</dd>
            </dl>
            {canForget && !connected && <button class="drop-point__forget" type="button" onClick={onForget}>Take off the list</button>}
        </li>
    );
}
