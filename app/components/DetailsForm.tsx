import { useEffect, useState } from "preact/hooks";
import type { DescribeField } from "../../core/types";
import { attempt, stewards, tell, useLibrary, views, viewer } from "../state";
import { formatEditors, mayEdit, parseEditors, type Editors } from "../../core/views";
import { MEDIUMS, displayName } from "../format";

const FIELDS: { field: DescribeField, label: string, long?: boolean, max: number }[] = [
    { field: "title", label: "Title", max: 200 },
    { field: "subtitle", label: "Subtitle", max: 200 },
    { field: "author", label: "By", max: 200 },
    { field: "year", label: "Year", max: 20 },
    { field: "description", label: "About it", long: true, max: 1000 },
    { field: "alt", label: "Describe it for someone who can't see it", long: true, max: 1000 }
];

// Metadata is a contribution like any other. Saving sends one small op per
// field that changed; nobody's earlier answer is erased, the latest is shown.
// Who may change it is the uploader's choice (everyone, unless they say otherwise).
export function DetailsForm({ id }: { id: string }) {
    const v = views.value;
    const me = viewer.value;
    const doc = v.documents[id];
    const owner = doc.user === me || stewards.value.includes(me);
    if (!mayEdit(doc, me, stewards.value)) {
        const who = displayName(doc.user, v.names, me);
        const e = parseEditors(doc.properties.editors);
        return (
            <p class="details-form__locked">
                {e?.kind === "people" ? `Only ${who} and the people they chose can change these details.` : `Only ${who} can change these details.`}
            </p>
        );
    }
    return (
        <>
            <DetailsFields id={id} />
            {owner && <EditorsChooser id={id} />}
        </>
    );
}

function DetailsFields({ id }: { id: string }) {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const p = v.documents[id].properties;
    const credits = v.credits[id] ?? {};
    const current = (field: DescribeField): string => p[field] ?? "";

    const [draft, setDraft] = useState<Partial<Record<DescribeField, string>>>({});
    // a different document is a different form
    useEffect(() => setDraft({}), [id]);

    const value = (field: DescribeField) => draft[field] ?? current(field);
    const edit = (field: DescribeField) => (e: Event) =>
        setDraft({ ...draft, [field]: (e.currentTarget as HTMLInputElement).value });
    const changes: Partial<Record<DescribeField, string>> = {};
    for (const [field, text] of Object.entries(draft) as [DescribeField, string][]) {
        if (text.trim() !== current(field)) changes[field] = text;
    }
    const count = Object.keys(changes).length;

    const credit = (field: DescribeField) => credits[field] && (
        <span class="details-form__credit">from {displayName(credits[field]!.user, v.names, me)}</span>
    );

    return (
        <form class="details-form" onSubmit={e => {
            e.preventDefault();
            if (!count) return;
            if (changes.title !== undefined && !changes.title.trim()) { tell("A document needs a title.", true); return; }
            attempt(async () => {
                await store.describe(id, changes);
                setDraft({});
                tell(count === 1 ? "Detail saved." : `${count} details saved.`);
            });
        }}>
            {FIELDS.map(({ field, label, long, max }) => (
                <label class="details-form__field" key={field}>
                    <span class="details-form__label">{label} {credit(field)}</span>
                    {long
                        ? <textarea class="details-form__input" rows={3} maxLength={max} value={value(field)} onInput={edit(field)} />
                        : <input class="details-form__input" maxLength={max} value={value(field)} onInput={edit(field)} />}
                </label>
            ))}
            <label class="details-form__field">
                <span class="details-form__label">Kind {credit("type")}</span>
                <select class="details-form__input" value={value("type")} onChange={edit("type")}>
                    {MEDIUMS.map(([v2, label]) => <option value={v2} key={v2}>{label}</option>)}
                </select>
            </label>
            <button class="details-form__save" type="submit" disabled={!count}>
                {count ? `Save ${count} change${count === 1 ? "" : "s"}` : "Nothing changed"}
            </button>
        </form>
    );
}

// The uploader's switch: everyone, only them, or people they pick. Changeable any time;
// edits already made stay, and from then on only the chosen people's count.
function EditorsChooser({ id }: { id: string }) {
    const store = useLibrary();
    const v = views.value;
    const me = viewer.value;
    const doc = v.documents[id];
    const current = parseEditors(doc.properties.editors) ?? { kind: "everyone" as const };
    const [choice, setChoice] = useState<Editors>(current);
    useEffect(() => setChoice(current), [id, doc.properties.editors]);
    const candidates = v.people.filter(u => u !== doc.user && u !== "steward");
    const chosen = choice.kind === "people" ? choice.users : [];
    const changed = formatEditors(choice) !== formatEditors(current);

    const pick = (kind: Editors["kind"]) => setChoice(kind === "people" ? { kind, users: chosen } : { kind });
    const toggle = (u: string) => setChoice({ kind: "people", users: chosen.includes(u) ? chosen.filter(x => x !== u) : [...chosen, u] });

    return (
        <form class="editors" onSubmit={e => {
            e.preventDefault();
            if (!changed) return;
            attempt(async () => {
                await store.describe(id, { editors: formatEditors(choice) });
                tell(choice.kind === "everyone" ? "Anyone can change the details now." : choice.kind === "owner" ? "Only you can change the details now." : "Only you and the people you chose can change the details now.");
            });
        }}>
            <fieldset class="editors__set">
                <legend class="editors__legend">Who can change these details</legend>
                {([["everyone", "Everyone"], ["owner", doc.user === me ? "Only me" : `Only ${displayName(doc.user, v.names, me)}`], ["people", "People I choose"]] as [Editors["kind"], string][]).map(([kind, label]) => (
                    <label class="editors__option" key={kind}>
                        <input type="radio" name={`editors-${id}`} checked={choice.kind === kind} onChange={() => pick(kind)} /> {label}
                    </label>
                ))}
                {choice.kind === "people" && (
                    candidates.length ? (
                        <ul class="editors__people">
                            {candidates.map(u => (
                                <li key={u}>
                                    <label class="editors__person">
                                        <input type="checkbox" checked={chosen.includes(u)} onChange={() => toggle(u)} /> {displayName(u, v.names, me)}
                                        <span class="editors__device"> · device {u.replace(/^d-/, "").slice(0, 8)}</span>
                                    </label>
                                </li>
                            ))}
                        </ul>
                    ) : <p class="editors__none">Nobody else has used the library yet. People appear here once they've added, noted or kept something.</p>
                )}
                <p class="editors__note">The library's stewards can always change them. Edits already made stay.</p>
            </fieldset>
            <button class="editors__save" type="submit" disabled={!changed}>{changed ? "Save who can edit" : "Saved"}</button>
        </form>
    );
}
