import { z } from 'zod';
import { conflictSchema, diagnosticSchema } from './diagnostics.js';
import { blueprintIdSchema, relativePathSchema, semverRangeSchema } from './primitives.js';

/**
 * A file as it will exist on disk. `contents` is a string for text and a Buffer
 * for verbatim binary copies, so the plan can be serialized (web preview, zip)
 * or written (CLI) from the same shape.
 */
export interface PlannedFile {
    path: string;
    contents: string | Buffer;
    /** Numeric mode, e.g. 0o644. */
    mode: number;
    /** Every blueprint that contributed a fragment, in graph order. */
    sources: string[];
    binary: boolean;
}

export const plannedFileSchema = z.object({
    path: relativePathSchema,
    contents: z.union([z.string(), z.instanceof(Buffer)]),
    mode: z.number().int().nonnegative(),
    sources: z.array(blueprintIdSchema),
    binary: z.boolean(),
});

export const postActionKindSchema = z.enum([
    'git-init',
    'write-config',
    'install',
    'format',
    'git-commit',
]);
export type PostActionKind = z.infer<typeof postActionKindSchema>;

/** Fixed execution order, independent of how the actions were collected. */
export const POST_ACTION_ORDER: PostActionKind[] = [
    'git-init',
    'write-config',
    'install',
    'format',
    'git-commit',
];

export const postActionSchema = z.object({
    kind: postActionKindSchema,
    /** One line for the CLI's progress output, e.g. "Installing dependencies". */
    label: z.string().min(1),
    /** Set when the user or the environment turned this action off. */
    skipped: z.boolean().default(false),
    skipReason: z.string().optional(),
    /** Command to run, when the action shells out. */
    command: z.string().optional(),
    args: z.array(z.string()).default([]),
});

export type PostAction = z.infer<typeof postActionSchema>;

export const dependencyEntrySchema = z.object({
    name: z.string().min(1),
    range: semverRangeSchema,
    dev: z.boolean().default(false),
    /** Which blueprints asked for this package. */
    requestedBy: z.array(blueprintIdSchema).default([]),
});

export type DependencyEntry = z.infer<typeof dependencyEntrySchema>;

export const dependencySummarySchema = z.object({
    dependencies: z.array(dependencyEntrySchema).default([]),
    devDependencies: z.array(dependencyEntrySchema).default([]),
});

export type DependencySummary = z.infer<typeof dependencySummarySchema>;

export interface GenerationPlan {
    specVersion: number;
    /** Deterministically sorted by path. */
    files: PlannedFile[];
    /** Non-empty means the plan is invalid and must not be written. */
    conflicts: z.infer<typeof conflictSchema>[];
    actions: PostAction[];
    warnings: z.infer<typeof diagnosticSchema>[];
    summary: {
        fileCount: number;
        totalBytes: number;
        deps: DependencySummary;
        blueprints: { id: string; version: string }[];
        nextSteps: string[];
    };
}

export const generationPlanSchema = z.object({
    specVersion: z.number().int().positive(),
    files: z.array(plannedFileSchema),
    conflicts: z.array(conflictSchema),
    actions: z.array(postActionSchema),
    warnings: z.array(diagnosticSchema),
    summary: z.object({
        fileCount: z.number().int().nonnegative(),
        totalBytes: z.number().int().nonnegative(),
        deps: dependencySummarySchema,
        blueprints: z.array(z.object({ id: z.string(), version: z.string() })),
        nextSteps: z.array(z.string()),
    }),
});

/** What actually happened once a plan was committed to disk. */
export interface GenerationResult {
    targetDir: string;
    filesWritten: string[];
    actions: { kind: PostActionKind; ok: boolean; skipped: boolean; message?: string }[];
    diagnostics: z.infer<typeof diagnosticSchema>[];
    durationMs: number;
}
