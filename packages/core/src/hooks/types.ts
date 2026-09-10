import type { Diagnostic, JsonValue } from '@atarashi/schema';
import type { RenderContext } from '../context.js';
import type { LoadedBlueprint } from '../types.js';

export const HOOK_NAMES = ['beforeRender', 'afterRender', 'afterPlan'] as const;
export type HookName = (typeof HOOK_NAMES)[number];

/**
 * Node builtins a hook may import. Everything else — `fs`, `child_process`,
 * `net`, `worker_threads`, `vm`, `process` — is refused by the loader inside
 * the worker (doc 09, T2).
 */
export const ALLOWED_BUILTINS = [
    'assert',
    'buffer',
    'events',
    'path',
    'querystring',
    'string_decoder',
    'url',
    'util',
] as const;

/** Hooks are JavaScript. A blueprint ships built output, not TypeScript source. */
export const HOOK_MODULE_EXTENSIONS = ['.js', '.mjs', '.cjs'];

/** The hard ceiling on `hooks.timeoutMs`, whatever a manifest asks for. */
export const MAX_HOOK_TIMEOUT_MS = 30_000;
export const DEFAULT_HOOK_TIMEOUT_MS = 5_000;

/** A file as a hook sees it. `contents` crosses the worker boundary by clone. */
export interface HookFile {
    path: string;
    contents: string | Uint8Array;
    mode: number;
    sources: string[];
    binary: boolean;
}

/** The read-only view of the run, present only with the `read-context` capability. */
export interface HookContextView {
    project: RenderContext['project'];
    answers: Record<string, JsonValue>;
    options: RenderContext['options'];
    pm: RenderContext['pm'];
    blueprints: ReadonlyArray<{ id: string; version: string }>;
    atarashi: RenderContext['atarashi'];
    has(id: string): boolean;
    provides(capability: string): boolean;
}

export interface BeforeRenderSubject {
    /** Mutable: a hook may add or override answers before templates see them. */
    answers: Record<string, JsonValue>;
}

export interface AfterRenderSubject {
    files: HookFile[];
}

export interface AfterPlanSubject {
    files: HookFile[];
    warnings: Diagnostic[];
    nextSteps: string[];
    blueprints: ReadonlyArray<{ id: string; version: string }>;
}

export type HookSubject = BeforeRenderSubject | AfterRenderSubject | AfterPlanSubject;

export interface HookCapabilities {
    readFiles: boolean;
    writeFiles: boolean;
    readContext: boolean;
}

/**
 * Asked before an untrusted blueprint's hooks run. The CLI implements it as the
 * consent prompt in doc 09; the web builder refuses outright by not passing one.
 */
export type HookConsent = (request: {
    blueprint: LoadedBlueprint;
    capabilities: string[];
    hook: HookName;
}) => boolean | Promise<boolean>;

export interface HookRunnerOptions {
    /** `--no-hooks`. Every hook is skipped with a warning. */
    enabled?: boolean;
    consent?: HookConsent;
    /** Lowers, never raises, the per-hook timeout. */
    timeoutMs?: number;
}

export interface HookOutcome<T> {
    value: T;
    diagnostics: Diagnostic[];
}
