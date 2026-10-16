import { keptCollectionId } from "../../core/ops";
import { attempt, person, useLibrary, views } from "../state";

// The one-tap first action: keep it (and carry it home).
export function KeepButton({ id }: { id: string }) {
    const store = useLibrary();
    const kept = views.value.collectionsByDocument[id]?.includes(keptCollectionId(person.value)) ?? false;
    return (
        <button
            class={`keep-button${kept ? " keep-button--kept" : ""}`}
            type="button"
            aria-pressed={kept}
            onClick={() => attempt(() => kept ? store.unkeep(id) : store.keep(id))}
        >{kept ? "Kept" : "Keep"}</button>
    );
}
