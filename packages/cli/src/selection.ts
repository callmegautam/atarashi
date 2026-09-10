import type { JsonValue, PresetManifest, SelectedBlueprint } from '@atarashi/schema';

export interface SelectionInput {
    preset?: PresetManifest;
    custom?: string[];
    add?: string[];
    remove?: string[];
}

/**
 * The directly-chosen blueprints for a `ProjectSpec` — preset minus `--remove`,
 * plus `--add`/custom picks, deduplicated. Anything a blueprint here
 * transitively needs is filled in by the resolver as `reason: 'auto'`, so it
 * never has to be listed here.
 */
export function resolveSelection(input: SelectionInput): {
    blueprints: SelectedBlueprint[];
    answers: Record<string, JsonValue>;
} {
    const remove = new Set(input.remove ?? []);
    const base = (input.preset?.blueprints ?? input.custom ?? []).filter((id) => !remove.has(id));
    const reason = input.preset ? 'preset' : 'user';

    const ids = new Map<string, SelectedBlueprint>();
    for (const id of base) ids.set(id, { id, reason });
    for (const id of input.add ?? []) {
        if (!remove.has(id)) ids.set(id, { id, reason: 'user' });
    }

    return {
        blueprints: [...ids.values()],
        answers: { ...(input.preset?.answers ?? {}) },
    };
}
