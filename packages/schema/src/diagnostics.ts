import { z } from 'zod';
import { blueprintIdSchema, relativePathSchema } from './primitives.js';

export const diagnosticSeveritySchema = z.enum(['error', 'warning', 'info']);
export type DiagnosticSeverity = z.infer<typeof diagnosticSeveritySchema>;

/**
 * Stable machine-readable codes. The CLI maps these to exit codes and the web
 * builder maps them to UI affordances, so treat them as public API.
 */
export const DIAGNOSTIC_CODES = {
    // resolution
    UNKNOWN_BLUEPRINT: 'ATA_UNKNOWN_BLUEPRINT',
    UNSATISFIED_REQUIREMENT: 'ATA_UNSATISFIED_REQUIREMENT',
    AMBIGUOUS_REQUIREMENT: 'ATA_AMBIGUOUS_REQUIREMENT',
    CAPABILITY_CONFLICT: 'ATA_CAPABILITY_CONFLICT',
    DEPENDENCY_CYCLE: 'ATA_DEPENDENCY_CYCLE',
    ENGINE_INCOMPATIBLE: 'ATA_ENGINE_INCOMPATIBLE',
    BLUEPRINT_DEPRECATED: 'ATA_BLUEPRINT_DEPRECATED',
    BLUEPRINT_EXPERIMENTAL: 'ATA_BLUEPRINT_EXPERIMENTAL',
    AUTO_ADDED: 'ATA_AUTO_ADDED',

    // prompts & context
    PROMPT_NAME_COLLISION: 'ATA_PROMPT_NAME_COLLISION',
    MISSING_ANSWER: 'ATA_MISSING_ANSWER',
    INVALID_ANSWER: 'ATA_INVALID_ANSWER',

    // rendering & merging
    RENDER_FAILED: 'ATA_RENDER_FAILED',
    EXPRESSION_FAILED: 'ATA_EXPRESSION_FAILED',
    MERGE_CONFLICT: 'ATA_MERGE_CONFLICT',
    OVERWRITTEN_FILE: 'ATA_OVERWRITTEN_FILE',
    VERSION_RANGE_CONFLICT: 'ATA_VERSION_RANGE_CONFLICT',
    UNDECLARED_SLOT: 'ATA_UNDECLARED_SLOT',

    // plan validation
    PATH_ESCAPE: 'ATA_PATH_ESCAPE',
    PATH_CASE_COLLISION: 'ATA_PATH_CASE_COLLISION',
    FILE_TOO_LARGE: 'ATA_FILE_TOO_LARGE',
    INVALID_GENERATED_JSON: 'ATA_INVALID_GENERATED_JSON',
    UNDECLARED_ENV_KEY: 'ATA_UNDECLARED_ENV_KEY',

    // io & registry
    TARGET_NOT_EMPTY: 'ATA_TARGET_NOT_EMPTY',
    WRITE_FAILED: 'ATA_WRITE_FAILED',
    /** Ctrl-C during a write. Everything staged is rolled back first. */
    INTERRUPTED: 'ATA_INTERRUPTED',
    ACTION_FAILED: 'ATA_ACTION_FAILED',
    REGISTRY_UNAVAILABLE: 'ATA_REGISTRY_UNAVAILABLE',
    INTEGRITY_MISMATCH: 'ATA_INTEGRITY_MISMATCH',

    // versioning
    SPEC_VERSION_UNSUPPORTED: 'ATA_SPEC_VERSION_UNSUPPORTED',
    MANIFEST_VERSION_UNSUPPORTED: 'ATA_MANIFEST_VERSION_UNSUPPORTED',
    SCHEMA_INVALID: 'ATA_SCHEMA_INVALID',
} as const;

export type DiagnosticCode = (typeof DIAGNOSTIC_CODES)[keyof typeof DIAGNOSTIC_CODES];

export const diagnosticSchema = z.object({
    severity: diagnosticSeveritySchema,
    /** One of `DIAGNOSTIC_CODES`. Kept as a string so plugins can extend it. */
    code: z.string().min(1),
    /** One line, no trailing period, no ANSI. The CLI does the styling. */
    message: z.string().min(1),
    /** Blueprints involved — always name both sides of a clash. */
    blueprints: z.array(blueprintIdSchema).optional(),
    /** Project-relative file the diagnostic is about, when there is one. */
    path: relativePathSchema.optional(),
    /** Concrete next actions. At least one, whenever we can name one. */
    suggestions: z.array(z.string().min(1)).optional(),
    /** Free-form detail for `--json` consumers; never printed raw. */
    detail: z.string().optional(),
});

export type Diagnostic = z.infer<typeof diagnosticSchema>;

export const conflictKindSchema = z.enum([
    'file',
    'dependency-range',
    'script',
    'env-value',
    'capability',
]);
export type ConflictKind = z.infer<typeof conflictKindSchema>;

export const conflictSchema = z.object({
    kind: conflictKindSchema,
    /** The file path, dependency name, script name or env key at issue. */
    subject: z.string().min(1),
    blueprints: z.array(blueprintIdSchema).min(1),
    message: z.string().min(1),
    suggestions: z.array(z.string().min(1)).default([]),
});

export type Conflict = z.infer<typeof conflictSchema>;

export const error = (
    code: DiagnosticCode | string,
    message: string,
    rest: Omit<Diagnostic, 'severity' | 'code' | 'message'> = {}
): Diagnostic => ({ severity: 'error', code, message, ...rest });

export const warning = (
    code: DiagnosticCode | string,
    message: string,
    rest: Omit<Diagnostic, 'severity' | 'code' | 'message'> = {}
): Diagnostic => ({ severity: 'warning', code, message, ...rest });

export const info = (
    code: DiagnosticCode | string,
    message: string,
    rest: Omit<Diagnostic, 'severity' | 'code' | 'message'> = {}
): Diagnostic => ({ severity: 'info', code, message, ...rest });
