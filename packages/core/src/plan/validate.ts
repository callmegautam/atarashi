import {
    DIAGNOSTIC_CODES,
    type Diagnostic,
    error,
    type GenerationPlan,
    warning,
} from '@atarashi/schema';
import YAML from 'yaml';
import { caseKey } from '../write/paths.js';

/** A single generated file above this is almost always a runaway template loop. */
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** And a whole project above this is a bug, not a scaffold. */
export const MAX_TOTAL_BYTES = 50 * 1024 * 1024;

const ENV_REFERENCE = /process\.env\.([A-Z][A-Z0-9_]*)|process\.env\[['"]([A-Z][A-Z0-9_]*)['"]\]/g;

/**
 * The last gate before a plan may be written. Everything here is a property of
 * the finished output rather than of any one blueprint, which is why it cannot
 * live in the merger.
 */
export function validatePlan(plan: GenerationPlan, declaredEnvKeys: Set<string>): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    if (plan.files.length === 0) {
        diagnostics.push(
            error(DIAGNOSTIC_CODES.SCHEMA_INVALID, 'The plan contains no files', {
                suggestions: ['Select at least one blueprint that contributes files'],
            })
        );
    }

    const seenCase = new Map<string, string>();
    let total = 0;

    for (const file of plan.files) {
        const bytes = Buffer.isBuffer(file.contents)
            ? file.contents.byteLength
            : Buffer.byteLength(file.contents, 'utf8');
        total += bytes;

        if (bytes > MAX_FILE_BYTES) {
            diagnostics.push(
                error(
                    DIAGNOSTIC_CODES.FILE_TOO_LARGE,
                    `\`${file.path}\` is ${Math.round(bytes / 1024 / 1024)} MB, past the ${MAX_FILE_BYTES / 1024 / 1024} MB cap`,
                    { path: file.path, blueprints: file.sources }
                )
            );
        }

        const key = caseKey(file.path);
        const existing = seenCase.get(key);
        if (existing && existing !== file.path) {
            diagnostics.push(
                error(
                    DIAGNOSTIC_CODES.PATH_CASE_COLLISION,
                    `\`${file.path}\` and \`${existing}\` differ only by case`,
                    { path: file.path, blueprints: file.sources }
                )
            );
        }
        seenCase.set(key, file.path);

        // Every path already passed `normalizeProjectPath`; this catches a
        // hook or a caller that assembled a plan by hand.
        if (file.path.startsWith('/') || file.path.split('/').includes('..')) {
            diagnostics.push(
                error(
                    DIAGNOSTIC_CODES.PATH_ESCAPE,
                    `\`${file.path}\` resolves outside the target directory`,
                    { path: file.path, blueprints: file.sources }
                )
            );
        }
    }

    if (total > MAX_TOTAL_BYTES) {
        diagnostics.push(
            error(
                DIAGNOSTIC_CODES.FILE_TOO_LARGE,
                `The generated project is ${Math.round(total / 1024 / 1024)} MB, past the ${MAX_TOTAL_BYTES / 1024 / 1024} MB cap`
            )
        );
    }

    diagnostics.push(...validateSyntax(plan));
    diagnostics.push(...validateEnvReferences(plan, declaredEnvKeys));

    return diagnostics;
}

/** Generated JSON and YAML must parse — a broken `package.json` blocks install. */
function validateSyntax(plan: GenerationPlan): Diagnostic[] {
    const diagnostics: Diagnostic[] = [];

    for (const file of plan.files) {
        if (file.binary || typeof file.contents !== 'string') continue;

        if (file.path.endsWith('.json')) {
            try {
                JSON.parse(file.contents);
            } catch (caught) {
                diagnostics.push(
                    error(
                        DIAGNOSTIC_CODES.INVALID_GENERATED_JSON,
                        `Generated \`${file.path}\` is not valid JSON: ${(caught as Error).message}`,
                        { path: file.path, blueprints: file.sources }
                    )
                );
            }
            continue;
        }

        if (/\.ya?ml$/.test(file.path)) {
            try {
                YAML.parse(file.contents);
            } catch (caught) {
                diagnostics.push(
                    error(
                        DIAGNOSTIC_CODES.INVALID_GENERATED_JSON,
                        `Generated \`${file.path}\` is not valid YAML: ${(caught as Error).message}`,
                        { path: file.path, blueprints: file.sources }
                    )
                );
            }
        }
    }

    return diagnostics;
}

/**
 * Catches the `PORT=DEMO` class of bug at generation time: a template reads
 * `process.env.X`, but no blueprint declared `X`, so the generated project
 * boots against an undefined variable.
 */
function validateEnvReferences(plan: GenerationPlan, declared: Set<string>): Diagnostic[] {
    const referenced = new Map<string, string>();

    for (const file of plan.files) {
        if (file.binary || typeof file.contents !== 'string') continue;
        if (!/\.(ts|tsx|js|jsx|mjs|cjs)$/.test(file.path)) continue;

        for (const match of file.contents.matchAll(ENV_REFERENCE)) {
            const key = match[1] ?? match[2];
            if (key && !referenced.has(key)) referenced.set(key, file.path);
        }
    }

    return [...referenced.entries()]
        .filter(([key]) => !declared.has(key))
        .sort(([a], [b]) => (a < b ? -1 : 1))
        .map(([key, path]) =>
            warning(
                DIAGNOSTIC_CODES.UNDECLARED_ENV_KEY,
                `\`${path}\` reads \`process.env.${key}\`, which no blueprint declares`,
                {
                    path,
                    suggestions: [
                        `Add \`${key}\` to the \`env\` list of the blueprint that needs it`,
                    ],
                }
            )
        );
}
