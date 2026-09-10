import { z } from 'zod';

/** JSON values are the only thing that crosses the CLI/web/registry boundary. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export const jsonPrimitiveSchema = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const jsonValueSchema: z.ZodType<JsonValue> = z.lazy(() =>
    z.union([jsonPrimitiveSchema, z.array(jsonValueSchema), z.record(jsonValueSchema)])
);

export const jsonObjectSchema = z.record(jsonValueSchema);

/**
 * `namespace/name`, e.g. `db/postgres`. Lowercase so ids never collide on a
 * case-insensitive filesystem.
 */
export const BLUEPRINT_ID_PATTERN = /^[a-z][a-z0-9-]*\/[a-z][a-z0-9-]*$/;

export const blueprintIdSchema = z
    .string()
    .regex(
        BLUEPRINT_ID_PATTERN,
        'blueprint id must be `namespace/name` in lowercase, e.g. "db/postgres"'
    );

export type BlueprintId = z.infer<typeof blueprintIdSchema>;

/** `domain` or `domain:qualifier`, e.g. `database`, `database:sql`. */
export const CAPABILITY_PATTERN = /^[a-z][a-z0-9-]*(:[a-z][a-z0-9-]*)*$/;

export const capabilitySchema = z
    .string()
    .regex(CAPABILITY_PATTERN, 'capability must look like `domain` or `domain:qualifier`');

export type Capability = z.infer<typeof capabilitySchema>;

/**
 * Capability namespaces reserved for the first-party catalogue. Third-party
 * blueprints may *require* these but may not invent new tokens inside them.
 */
export const RESERVED_CAPABILITY_NAMESPACES = [
    'runtime',
    'language',
    'http',
    'database',
    'orm',
    'auth',
    'ci',
    'infra',
    'test',
    'lint',
    'ui',
] as const;

const SEMVER_PATTERN =
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export const semverSchema = z.string().regex(SEMVER_PATTERN, 'must be an exact semver version');

/** A semver *range* — not validated structurally here; `semver` does that in core. */
export const semverRangeSchema = z.string().min(1);

/** Project-relative POSIX path. Rejects absolute paths and traversal outright. */
export const relativePathSchema = z
    .string()
    .min(1)
    .refine((p) => !p.startsWith('/') && !/^[a-zA-Z]:[\\/]/.test(p), {
        message: 'path must be project-relative, not absolute',
    })
    .refine((p) => !p.split(/[\\/]/).includes('..'), {
        message: 'path must not contain a `..` segment',
    })
    .refine((p) => !p.includes('\0'), { message: 'path must not contain a null byte' });

/** Subresource-integrity style digest, e.g. `sha256-BASE64`. */
export const integritySchema = z
    .string()
    .regex(/^sha(256|384|512)-[A-Za-z0-9+/]+={0,2}$/, 'must be an SRI digest, e.g. "sha256-…"');

export const packageManagerSchema = z.enum(['pnpm', 'npm', 'yarn', 'bun']);
export type PackageManager = z.infer<typeof packageManagerSchema>;
