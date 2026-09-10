import { z } from 'zod';
import {
    blueprintIdSchema,
    integritySchema,
    jsonValueSchema,
    packageManagerSchema,
    semverSchema,
} from './primitives.js';

/** Bumped only when `ProjectSpec` changes incompatibly. */
export const CURRENT_SPEC_VERSION = 1;

/** npm package names double as project names, so borrow their rules. */
export const projectNameSchema = z
    .string()
    .min(1)
    .max(214)
    .regex(
        /^(?:@[a-z0-9-*~][a-z0-9-*._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/,
        'project name must be a valid npm package name (lowercase, no spaces)'
    );

export const registryPinSchema = z.object({
    /** Exact registry index version this spec was resolved against. */
    version: semverSchema,
    integrity: integritySchema.optional(),
    /** Non-default registry source, when one was used. */
    source: z.string().url().optional(),
});

export type RegistryPin = z.infer<typeof registryPinSchema>;

export const selectedBlueprintSchema = z.object({
    id: blueprintIdSchema,
    /** Pinned at resolve time so regeneration is byte-identical. */
    version: semverSchema.optional(),
    /**
     * Why this blueprint is in the graph. `auto` entries were added by the
     * resolver to satisfy a `requires`, and are reported to the user.
     */
    reason: z.enum(['user', 'preset', 'auto']).default('user'),
    /** For `auto`: the blueprint whose requirement pulled this one in. */
    requiredBy: blueprintIdSchema.optional(),
});

export type SelectedBlueprint = z.infer<typeof selectedBlueprintSchema>;

export const authorSchema = z.object({
    name: z.string().optional(),
    email: z.string().email().optional(),
    url: z.string().url().optional(),
});

export const projectOptionsSchema = z.object({
    packageManager: packageManagerSchema.default('pnpm'),
    git: z.boolean().default(true),
    install: z.boolean().default(true),
    format: z.boolean().default(true),
    initialCommit: z.boolean().default(true),
    license: z.string().nullable().default('MIT'),
    author: authorSchema.nullable().default(null),
    /** Write a real `.env` alongside `.env.example`. Off by default. */
    writeEnv: z.boolean().default(false),
    /** Overwrite a non-empty target directory. Never implied by `--yes`. */
    force: z.boolean().default(false),
});

export type ProjectOptions = z.infer<typeof projectOptionsSchema>;

export const projectSpecSchema = z
    .object({
        specVersion: z.number().int().positive(),
        name: projectNameSchema,
        description: z.string().max(200).optional(),
        /** Resolved absolute path. Absent for web-builder specs, which never write. */
        targetDir: z.string().min(1).optional(),
        registry: registryPinSchema.optional(),
        preset: z.string().optional(),
        blueprints: z.array(selectedBlueprintSchema).default([]),
        /** Flattened prompt answers, keyed by the prompt's globally unique name. */
        answers: z.record(jsonValueSchema).default({}),
        options: projectOptionsSchema.default({}),
    })
    .strict();

export type ProjectSpec = z.infer<typeof projectSpecSchema>;

/**
 * `atarashi.json`, written into every generated project. It is a `ProjectSpec`
 * plus what it took to produce this exact output — enough to regenerate it
 * byte-for-byte, and enough for `atarashi add` to know what is already there.
 */
export const projectConfigSchema = z
    .object({
        $schema: z.string().optional(),
        specVersion: z.number().int().positive(),
        atarashiVersion: z.string().min(1),
        registry: registryPinSchema.optional(),
        generatedAt: z.string().datetime(),
        name: projectNameSchema,
        description: z.string().max(200).optional(),
        preset: z.string().optional(),
        blueprints: z.array(z.object({ id: blueprintIdSchema, version: semverSchema })).default([]),
        answers: z.record(jsonValueSchema).default({}),
        options: projectOptionsSchema.partial().default({}),
    })
    .strict();

export type ProjectConfig = z.infer<typeof projectConfigSchema>;
