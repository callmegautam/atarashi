import type { z } from 'zod';
import { DIAGNOSTIC_CODES, error } from './diagnostics.js';
import {
    blueprintManifestSchema,
    CURRENT_MANIFEST_VERSION,
    presetManifestSchema,
} from './manifest.js';
import { registryIndexSchema, userConfigSchema } from './registry.js';
import { fail, ok, type Result } from './result.js';
import {
    CURRENT_SPEC_VERSION,
    projectConfigSchema,
    projectSpecSchema,
    registryPinSchema,
} from './spec.js';

export { CURRENT_MANIFEST_VERSION, CURRENT_SPEC_VERSION };

/** The manifest majors a loader of this version understands. */
export const SUPPORTED_MANIFEST_VERSIONS = [1] as const;
export const SUPPORTED_SPEC_VERSIONS = [1] as const;

const formatZodError = (issues: z.ZodIssue[]): string =>
    issues
        .map((issue) => {
            const at = issue.path.length > 0 ? issue.path.join('.') : '<root>';
            return `${at}: ${issue.message}`;
        })
        .join('\n');

function parseWith<S extends z.ZodTypeAny>(
    schema: S,
    input: unknown,
    what: string,
    source?: string
): Result<z.infer<S>> {
    const parsed = schema.safeParse(input);
    if (parsed.success) return ok(parsed.data);

    const where = source ? ` in ${source}` : '';
    return fail(
        DIAGNOSTIC_CODES.SCHEMA_INVALID,
        `Invalid ${what}${where}`,
        parsed.error.issues.map((issue) =>
            error(
                DIAGNOSTIC_CODES.SCHEMA_INVALID,
                `${issue.path.join('.') || '<root>'}: ${issue.message}`
            )
        )
    );
}

/**
 * Version guards run *before* schema validation so a manifest from a future
 * Atarashi says "upgrade atarashi" instead of drowning the user in unknown-key
 * errors.
 */
function checkVersion(
    value: unknown,
    field: string,
    supported: readonly number[],
    current: number,
    code: string,
    source?: string
): Result<number> {
    const where = source ? ` (${source})` : '';
    if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
        return fail(code, `Missing or invalid \`${field}\`${where}`, [
            error(code, `\`${field}\` must be a positive integer; this build writes ${current}`),
        ]);
    }
    if (supported.includes(value)) return ok(value);

    const tooNew = value > current;
    return fail(
        code,
        tooNew
            ? `\`${field}\` ${value} is newer than this version of Atarashi understands${where}`
            : `\`${field}\` ${value} is no longer supported${where}`,
        [
            error(
                code,
                tooNew
                    ? `This build supports ${field} ${supported.join(', ')}`
                    : `This build supports ${field} ${supported.join(', ')}; regenerate or migrate the file`,
                {
                    suggestions: tooNew
                        ? ['Upgrade Atarashi: `npm install -g atarashi@latest`']
                        : ['Run `atarashi doctor --fix` to migrate this file'],
                }
            ),
        ]
    );
}

export function parseBlueprintManifest(input: unknown, source?: string) {
    const version = checkVersion(
        (input as { manifestVersion?: unknown })?.manifestVersion,
        'manifestVersion',
        SUPPORTED_MANIFEST_VERSIONS,
        CURRENT_MANIFEST_VERSION,
        DIAGNOSTIC_CODES.MANIFEST_VERSION_UNSUPPORTED,
        source
    );
    if (!version.ok) return version as Result<never>;
    return parseWith(blueprintManifestSchema, input, 'blueprint manifest', source);
}

export function parsePresetManifest(input: unknown, source?: string) {
    const version = checkVersion(
        (input as { manifestVersion?: unknown })?.manifestVersion,
        'manifestVersion',
        SUPPORTED_MANIFEST_VERSIONS,
        CURRENT_MANIFEST_VERSION,
        DIAGNOSTIC_CODES.MANIFEST_VERSION_UNSUPPORTED,
        source
    );
    if (!version.ok) return version as Result<never>;
    return parseWith(presetManifestSchema, input, 'preset manifest', source);
}

/** Dispatches on `kind`, defaulting to `blueprint` when absent. */
export function parseManifest(input: unknown, source?: string) {
    const kind = (input as { kind?: unknown })?.kind;
    return kind === 'preset'
        ? parsePresetManifest(input, source)
        : parseBlueprintManifest(input, source);
}

export function parseProjectSpec(input: unknown, source?: string) {
    const version = checkVersion(
        (input as { specVersion?: unknown })?.specVersion,
        'specVersion',
        SUPPORTED_SPEC_VERSIONS,
        CURRENT_SPEC_VERSION,
        DIAGNOSTIC_CODES.SPEC_VERSION_UNSUPPORTED,
        source
    );
    if (!version.ok) return version as Result<never>;
    return parseWith(projectSpecSchema, input, 'project spec', source);
}

export function parseProjectConfig(input: unknown, source = 'atarashi.json') {
    const version = checkVersion(
        (input as { specVersion?: unknown })?.specVersion,
        'specVersion',
        SUPPORTED_SPEC_VERSIONS,
        CURRENT_SPEC_VERSION,
        DIAGNOSTIC_CODES.SPEC_VERSION_UNSUPPORTED,
        source
    );
    if (!version.ok) return version as Result<never>;
    return parseWith(projectConfigSchema, input, 'project config', source);
}

export function parseRegistryIndex(input: unknown, source?: string) {
    return parseWith(registryIndexSchema, input, 'registry index', source);
}

export function parseUserConfig(input: unknown, source?: string) {
    return parseWith(userConfigSchema, input, 'user config', source);
}

export function parseRegistryPin(input: unknown, source?: string) {
    return parseWith(registryPinSchema, input, 'registry pin', source);
}

export { formatZodError };
