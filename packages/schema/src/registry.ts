import { z } from 'zod';
import {
    blueprintIdSchema,
    capabilitySchema,
    integritySchema,
    semverRangeSchema,
    semverSchema,
} from './primitives.js';

/**
 * One entry in the registry index. Deliberately a *summary*: enough to search,
 * filter and resolve capabilities without downloading anything. The full
 * manifest arrives with the tarball.
 */
export const registryEntrySchema = z.object({
    id: blueprintIdSchema,
    kind: z.enum(['blueprint', 'preset']).default('blueprint'),
    name: z.string().min(1),
    version: semverSchema,
    description: z.string().min(1).max(200),
    category: z.string().min(1),
    tags: z.array(z.string()).default([]),
    provides: z.array(capabilitySchema).default([]),
    requires: z.array(capabilitySchema).default([]),
    conflicts: z.array(capabilitySchema).default([]),
    engines: z.object({ atarashi: semverRangeSchema.optional() }).default({}),
    experimental: z.boolean().default(false),
    deprecated: z.boolean().default(false),
    /** Where the tarball lives, relative to the index URL or absolute. */
    tarball: z.string().min(1),
    integrity: integritySchema,
    /** True for blueprints shipped inside the npm package (offline first-run). */
    bundled: z.boolean().default(false),
});

export type RegistryEntry = z.infer<typeof registryEntrySchema>;

/**
 * Pinned dependency versions shared by every blueprint, so `express@^5` is
 * bumped in one place instead of in twenty manifests.
 */
export const versionManifestSchema = z.object({
    version: semverSchema,
    updatedAt: z.string().datetime(),
    packages: z.record(semverRangeSchema),
});

export type VersionManifest = z.infer<typeof versionManifestSchema>;

export const registryIndexSchema = z
    .object({
        $schema: z.string().optional(),
        indexVersion: z.number().int().positive(),
        /** The registry's own version — what `ProjectSpec.registry.version` pins. */
        version: semverSchema,
        updatedAt: z.string().datetime(),
        /** Digest over the canonicalized `entries` array. Verified on load. */
        integrity: integritySchema.optional(),
        entries: z.array(registryEntrySchema).default([]),
        versionManifest: versionManifestSchema.optional(),
    })
    .strict();

export type RegistryIndex = z.infer<typeof registryIndexSchema>;

export const registrySourceSchema = z.object({
    name: z.string().min(1),
    url: z.string().url(),
    /** Third-party sources are untrusted: hooks are refused from them. */
    trusted: z.boolean().default(false),
    enabled: z.boolean().default(true),
});

export type RegistrySource = z.infer<typeof registrySourceSchema>;

/** `~/.config/atarashi/config.json` — user-level CLI settings. */
export const userConfigSchema = z
    .object({
        $schema: z.string().optional(),
        packageManager: z.enum(['pnpm', 'npm', 'yarn', 'bun']).optional(),
        git: z.boolean().optional(),
        install: z.boolean().optional(),
        format: z.boolean().optional(),
        initialCommit: z.boolean().optional(),
        license: z.string().nullable().optional(),
        author: z
            .object({
                name: z.string().optional(),
                email: z.string().email().optional(),
                url: z.string().url().optional(),
            })
            .optional(),
        registry: z
            .object({
                sources: z.array(registrySourceSchema).optional(),
                pin: semverSchema.nullable().optional(),
                offline: z.boolean().optional(),
            })
            .optional(),
        telemetry: z.boolean().optional(),
        updateNotifier: z.boolean().optional(),
    })
    .strict();

export type UserConfig = z.infer<typeof userConfigSchema>;
