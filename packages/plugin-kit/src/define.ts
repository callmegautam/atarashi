import {
    AtarashiError,
    type BlueprintManifest,
    blueprintManifestSchema,
    CURRENT_MANIFEST_VERSION,
    DIAGNOSTIC_CODES,
    error,
    type PresetManifest,
    presetManifestSchema,
} from '@atarashi/schema';
import type { z } from 'zod';

/**
 * `manifestVersion` and `kind` are what this build writes, not something an
 * author should have to remember, so both are filled in here.
 */
export type BlueprintDefinition = Omit<
    z.input<typeof blueprintManifestSchema>,
    'manifestVersion' | 'kind'
> & { manifestVersion?: number; kind?: 'blueprint' };

export type PresetDefinition = Omit<
    z.input<typeof presetManifestSchema>,
    'manifestVersion' | 'kind'
> & { manifestVersion?: number; kind?: 'preset' };

function parseOrThrow<S extends z.ZodTypeAny>(schema: S, input: unknown, what: string): z.infer<S> {
    const parsed = schema.safeParse(input);
    if (parsed.success) return parsed.data;

    const diagnostics = parsed.error.issues.map((issue) =>
        error(
            DIAGNOSTIC_CODES.SCHEMA_INVALID,
            `${issue.path.join('.') || '<root>'}: ${issue.message}`
        )
    );
    throw new AtarashiError(
        DIAGNOSTIC_CODES.SCHEMA_INVALID,
        `Invalid ${what}:\n${diagnostics.map((d) => `  ${d.message}`).join('\n')}`,
        diagnostics
    );
}

/**
 * Validates a blueprint manifest at authoring time and returns it fully
 * defaulted — the same object the loader would produce from `blueprint.json`.
 * Throws rather than returning a `Result`, because a malformed manifest is an
 * author's bug at build time, not a runtime condition to branch on.
 */
export function defineBlueprint(definition: BlueprintDefinition): BlueprintManifest {
    return parseOrThrow(
        blueprintManifestSchema,
        { manifestVersion: CURRENT_MANIFEST_VERSION, kind: 'blueprint', ...definition },
        'blueprint manifest'
    );
}

export function definePreset(definition: PresetDefinition): PresetManifest {
    return parseOrThrow(
        presetManifestSchema,
        { manifestVersion: CURRENT_MANIFEST_VERSION, kind: 'preset', ...definition },
        'preset manifest'
    );
}

/**
 * Serializes a manifest for writing to `blueprint.json` / `preset.json`. Keys
 * are emitted in a fixed order so a regenerated manifest diffs cleanly.
 */
export function toManifestJson(manifest: BlueprintManifest | PresetManifest): string {
    const ordered: Record<string, unknown> = {};
    const source = manifest as unknown as Record<string, unknown>;
    const preferred = [
        'manifestVersion',
        'kind',
        'id',
        'name',
        'version',
        'description',
        'category',
        'tags',
        'author',
        'license',
    ];
    for (const key of preferred) if (key in source) ordered[key] = source[key];
    for (const key of Object.keys(source).sort()) {
        if (!(key in ordered)) ordered[key] = source[key];
    }
    return `${JSON.stringify(ordered, null, 2)}\n`;
}
