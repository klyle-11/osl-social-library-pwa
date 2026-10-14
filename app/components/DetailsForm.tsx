import { useEffect, useState } from "preact/hooks";
import type { DescribeField } from "../../core/types";
import { attempt, tell, useLibrary, views, viewer } from "../state";
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
export function DetailsForm({ id }: { id: string }) {
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
