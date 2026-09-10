import { z } from 'zod';
import {
    blueprintIdSchema,
    capabilitySchema,
    jsonValueSchema,
    relativePathSchema,
    semverRangeSchema,
    semverSchema,
} from './primitives.js';

/** Bumped only on a breaking manifest change. Loaders support this and the previous major. */
export const CURRENT_MANIFEST_VERSION = 1;

/**
 * A `when` expression, e.g. `answers.usePool && has('infra/docker')`. Parsed and
 * interpreted by `@atarashi/core`; never `eval`'d. The schema only checks shape.
 */
export const whenExpressionSchema = z.string().min(1).max(500);

export const mergeStrategySchema = z.enum([
    'error',
    'overwrite',
    'json-deep',
    'yaml-deep',
    'env',
    'lines-unique',
    'ts-slots',
    'append',
    'prepend',
]);
export type MergeStrategy = z.infer<typeof mergeStrategySchema>;

export const promptTypeSchema = z.enum(['input', 'confirm', 'select', 'multiselect', 'number']);
export type PromptType = z.infer<typeof promptTypeSchema>;

export const promptChoiceSchema = z.object({
    value: z.union([z.string(), z.number(), z.boolean()]),
    label: z.string().min(1),
    hint: z.string().optional(),
    when: whenExpressionSchema.optional(),
});

export const promptValidationSchema = z.object({
    pattern: z.string().optional(),
    message: z.string().optional(),
    min: z.number().optional(),
    max: z.number().optional(),
});

export const promptSchema = z
    .object({
        /**
         * Unique across the whole resolved graph — a collision is a load-time
         * error, so blueprints prefix by domain (`db.name`, `auth.expiry`).
         */
        name: z.string().regex(/^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/, {
            message: 'prompt name must be dot-separated camelCase, e.g. "db.name"',
        }),
        type: promptTypeSchema,
        message: z.string().min(1),
        /** May be a template string, e.g. `{{ project.slug }}`. */
        default: jsonValueSchema.optional(),
        /** The non-interactive equivalent. Every prompt must have one. */
        flag: z
            .string()
            .regex(/^--[a-z][a-z0-9-]*$/, 'flag must look like "--db-name"')
            .optional(),
        choices: z.array(promptChoiceSchema).optional(),
        validate: promptValidationSchema.optional(),
        when: whenExpressionSchema.optional(),
        secret: z.boolean().default(false),
    })
    .superRefine((prompt, ctx) => {
        const needsChoices = prompt.type === 'select' || prompt.type === 'multiselect';
        if (needsChoices && (!prompt.choices || prompt.choices.length === 0)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `prompt "${prompt.name}" is a ${prompt.type} and must declare choices`,
                path: ['choices'],
            });
        }
        if (!needsChoices && prompt.choices) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                message: `prompt "${prompt.name}" is a ${prompt.type} and must not declare choices`,
                path: ['choices'],
            });
        }
    });

export type Prompt = z.infer<typeof promptSchema>;

export const fileEntrySchema = z.object({
    /** Path inside the blueprint's own directory. */
    from: relativePathSchema,
    /**
     * Destination, project-relative. Supports template expressions
     * (`src/models/{{ answers.entity }}.ts`). Defaults to `from` with the
     * leading `files/` and a trailing `.hbs` stripped.
     */
    to: relativePathSchema.optional(),
    when: whenExpressionSchema.optional(),
    /** `false` copies bytes verbatim — binaries, icons, snapshot fixtures. */
    render: z.boolean().default(true),
    merge: mergeStrategySchema.optional(),
    /** Octal file mode as a string, e.g. "755" for executables. */
    mode: z
        .string()
        .regex(/^[0-7]{3,4}$/, 'mode must be octal, e.g. "755"')
        .optional(),
    /** Opt back into HTML escaping for files that really are HTML. */
    escape: z.boolean().default(false),
});

export type FileEntry = z.infer<typeof fileEntrySchema>;

/** Either `"^8.14.1"` or `{ version, when }` for a conditional dependency. */
export const dependencySpecSchema = z.union([
    semverRangeSchema,
    z.object({
        version: semverRangeSchema.optional(),
        when: whenExpressionSchema.optional(),
        /**
         * Resolve the range from the registry's version manifest instead of
         * hardcoding it here. Defaults to true when `version` is omitted.
         */
        fromVersionManifest: z.boolean().optional(),
    }),
]);

export type DependencySpec = z.infer<typeof dependencySpecSchema>;

export const dependencyMapSchema = z.record(dependencySpecSchema);

export const scriptSpecSchema = z.union([
    z.string().min(1),
    z.object({ value: z.string().min(1), when: whenExpressionSchema.optional() }),
]);

/**
 * Scripts npm runs on its own, without the user asking. A blueprint from an
 * untrusted source may not declare one — that would be arbitrary code execution
 * on `install`, doc 09 § T3 — and the check lives in the merger, which is the
 * one place that sees every route to `package.json` together with the trust of
 * the blueprint each fragment came from.
 */
export const FORBIDDEN_SCRIPTS = [
    'preinstall',
    'install',
    'postinstall',
    'prepare',
    'prepublish',
    'preprepare',
    'postprepare',
] as const;

export const scriptMapSchema = z.record(scriptSpecSchema);

export const envEntrySchema = z.object({
    key: z.string().regex(/^[A-Z][A-Z0-9_]*$/, 'env keys are CONSTANT_CASE'),
    /** Template string rendered into `.env.example`. Never a real secret. */
    sample: z.string(),
    description: z.string().optional(),
    required: z.boolean().default(true),
    /** Secrets are written to `.env.example` with an empty value. */
    secret: z.boolean().default(false),
    /**
     * Fills `.env` (never `.env.example`) with a fresh random value, so a
     * generated project boots without the user having to mint a signing key by
     * hand. The suffix is the number of random bytes. Deliberately the one
     * thing in a generation that differs run to run.
     */
    generate: z.enum(['hex-32', 'hex-64', 'base64url-32']).optional(),
    /** Injected into the generated runtime validation schema. */
    schema: z.string().optional(),
    when: whenExpressionSchema.optional(),
});

export type EnvEntry = z.infer<typeof envEntrySchema>;

const slotContributionSchema = z.object({
    target: relativePathSchema,
    slot: z.string().regex(/^[a-z][a-z0-9-]*$/, 'slot names are lowercase-kebab'),
    value: z.string().min(1),
    when: whenExpressionSchema.optional(),
});

const mergeContributionSchema = z.object({
    target: relativePathSchema,
    merge: mergeStrategySchema,
    value: jsonValueSchema,
    when: whenExpressionSchema.optional(),
});

export const contributionSchema = z.union([slotContributionSchema, mergeContributionSchema]);
export type Contribution = z.infer<typeof contributionSchema>;

export const HOOK_EXPORTS = ['beforeRender', 'afterRender', 'afterPlan'] as const;

export const hooksSchema = z.object({
    module: relativePathSchema,
    exports: z.array(z.enum(HOOK_EXPORTS)).min(1),
    /** Capabilities the hook needs. Anything not listed is denied by the sandbox. */
    capabilities: z.array(z.enum(['read-files', 'write-files', 'read-context'])).default([]),
    /** Milliseconds. The sandbox kills the worker past this. */
    timeoutMs: z.number().int().positive().max(30_000).default(5_000),
});

export const deprecationSchema = z.object({
    since: semverSchema,
    use: blueprintIdSchema.optional(),
    reason: z.string().optional(),
});

export const enginesSchema = z.object({
    atarashi: semverRangeSchema.optional(),
    node: semverRangeSchema.optional(),
});

export const blueprintManifestSchema = z
    .object({
        manifestVersion: z.number().int().positive(),
        kind: z.literal('blueprint').default('blueprint'),

        // identity
        id: blueprintIdSchema,
        name: z.string().min(1),
        version: semverSchema,
        description: z.string().min(1).max(200),
        category: z.string().min(1),
        tags: z.array(z.string().min(1)).default([]),
        author: z.string().default('atarashi'),
        license: z.string().default('MIT'),
        docs: z.string().url().optional(),
        experimental: z.boolean().default(false),
        deprecated: deprecationSchema.nullish(),

        // composition graph
        provides: z.array(capabilitySchema).default([]),
        requires: z.array(capabilitySchema).default([]),
        conflicts: z.array(capabilitySchema).default([]),
        optionalPeers: z.array(blueprintIdSchema).default([]),
        after: z.array(blueprintIdSchema).default([]),
        /** Lower runs first. Ties break on id, so ordering is total and stable. */
        priority: z.number().int().min(0).max(1000).default(100),

        engines: enginesSchema.default({}),

        // contributions
        prompts: z.array(promptSchema).default([]),
        files: z.array(fileEntrySchema).default([]),
        dependencies: dependencyMapSchema.default({}),
        devDependencies: dependencyMapSchema.default({}),
        peerDependencies: dependencyMapSchema.default({}),
        scripts: scriptMapSchema.default({}),
        env: z.array(envEntrySchema).default([]),
        contributions: z.array(contributionSchema).default([]),
        gitignore: z.array(z.string().min(1)).default([]),

        hooks: hooksSchema.optional(),
        nextSteps: z.array(z.string().min(1)).default([]),
    })
    .strict()
    .superRefine((manifest, ctx) => {
        const names = new Set<string>();
        for (const prompt of manifest.prompts) {
            if (names.has(prompt.name)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `duplicate prompt name "${prompt.name}" within ${manifest.id}`,
                    path: ['prompts'],
                });
            }
            names.add(prompt.name);
        }

        // A blueprint that both provides and conflicts on the same token is the
        // normal "only one database" pattern, so that is allowed. Requiring a
        // token you also conflict with never resolves.
        for (const token of manifest.requires) {
            if (manifest.conflicts.includes(token)) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${manifest.id} both requires and conflicts on "${token}"`,
                    path: ['conflicts'],
                });
            }
        }
    });

export type BlueprintManifest = z.infer<typeof blueprintManifestSchema>;

export const presetManifestSchema = z
    .object({
        manifestVersion: z.number().int().positive(),
        kind: z.literal('preset'),
        /** Presets live in the `preset/` namespace, e.g. `preset/backend-ts`. */
        id: z
            .string()
            .regex(/^preset\/[a-z][a-z0-9-]*$/, 'preset ids look like "preset/backend-ts"'),
        name: z.string().min(1),
        version: semverSchema.default('1.0.0'),
        description: z.string().min(1).max(200),
        recommended: z.boolean().default(false),
        experimental: z.boolean().default(false),
        deprecated: deprecationSchema.nullish(),
        blueprints: z.array(blueprintIdSchema).min(1),
        answers: z.record(jsonValueSchema).default({}),
        tags: z.array(z.string().min(1)).default([]),
    })
    .strict();

export type PresetManifest = z.infer<typeof presetManifestSchema>;

export const manifestSchema = z.union([blueprintManifestSchema, presetManifestSchema]);
export type Manifest = z.infer<typeof manifestSchema>;
