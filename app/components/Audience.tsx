import { useState } from "preact/hooks";
import { formatAudience, isGroup, parseAudience, type Audience } from "../../core/access";
import { directory, person } from "../state";

// Who may see a collection, or add to it: everyone, only its owner, or chosen people and
// groups (core/access.ts). Only people with accounts can be chosen: a guest's device is
// not proof of who someone is.

export function describeAudience(a: Audience, ownerIsMe: boolean, what: "see" | "add"): string {
    if (a.kind === "everyone") return what === "see" ? "Everyone can see it" : "Anyone can add to it";
    if (a.kind === "owner") return what === "see" ? (ownerIsMe ? "Only you can see it" : "Only its owner can see it") : (ownerIsMe ? "Only you add to it" : "Only its owner adds to it");
    const d = directory.value;
    const groups = a.ids.filter(isGroup).map(id => d?.groups?.find(g => g.id === id)?.name ?? "a group");
    const people = a.ids.filter(id => !isGroup(id)).length;
    const parts = [...groups, ...(people ? [`${people} ${people === 1 ? "person" : "people"}`] : [])];
    const who = parts.length ? parts.join(", ") : "nobody else";
    return what === "see" ? `Shared with ${who}` : `${who.charAt(0).toUpperCase() + who.slice(1)} can add to it`;
}

export function AudiencePicker({ legend, value, onChange, what }: {
    legend: string, value: string, onChange: (value: string) => void, what: "see" | "add"
}) {
    const d = directory.value;
    const a = parseAudience(value) ?? (what === "see" ? { kind: "everyone" as const } : { kind: "owner" as const });
    const [find, setFind] = useState("");
    const me = person.value;
    const chosen = new Set(a.kind === "people" ? a.ids : []);
    const groups = d?.groups ?? [];
    const accounts = Object.entries(d?.accounts ?? {}).filter(([id]) => id !== me);
    const q = find.trim().toLowerCase();
    const listed = accounts.filter(([id, name]) => chosen.has(id) || !q || name.toLowerCase().includes(q)).slice(0, 30);
    const set = (next: Audience) => onChange(formatAudience(next));
    const toggle = (id: string, on: boolean) => {
        const ids = on ? [...chosen, id] : [...chosen].filter(x => x !== id);
        set({ kind: "people", ids });
    };
    const name = `audience-${what}`;

    return (
        <fieldset class="audience">
            <legend class="audience__legend">{legend}</legend>
            <label class="audience__option">
                <input type="radio" name={name} checked={a.kind === "everyone"} onChange={() => set({ kind: "everyone" })} />
                <span>{what === "see" ? "Everyone in this library" : "Anyone"}</span>
            </label>
            <label class="audience__option">
                <input type="radio" name={name} checked={a.kind === "owner"} onChange={() => set({ kind: "owner" })} />
                <span>Only me</span>
            </label>
            <label class="audience__option">
                <input type="radio" name={name} checked={a.kind === "people"} onChange={() => set({ kind: "people", ids: [...chosen] })} />
                <span>People and groups I choose</span>
            </label>
            {a.kind === "people" && (
                <div class="audience__choose">
                    {groups.length > 0 && (
                        <ul class="audience__list" aria-label="Groups">
                            {groups.map(g => (
                                <li key={g.id}>
                                    <label class="audience__check">
                                        <input type="checkbox" checked={chosen.has(g.id)} onChange={e => toggle(g.id, (e.currentTarget as HTMLInputElement).checked)} />
                                        <span><b>{g.name}</b> <span class="audience__muted">· group of {g.members.length}</span></span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    )}
                    {accounts.length > 8 && (
                        <label class="audience__find">Find someone
                            <input type="search" value={find} onInput={e => setFind((e.currentTarget as HTMLInputElement).value)} />
                        </label>
                    )}
                    {listed.length ? (
                        <ul class="audience__list" aria-label="People">
                            {listed.map(([id, n]) => (
                                <li key={id}>
                                    <label class="audience__check">
                                        <input type="checkbox" checked={chosen.has(id)} onChange={e => toggle(id, (e.currentTarget as HTMLInputElement).checked)} />
                                        <span>{n}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    ) : <p class="audience__muted">Nobody with an account has been here yet.</p>}
                    <p class="audience__muted">Only people with accounts can be chosen.</p>
                </div>
            )}
        </fieldset>
    );
}
