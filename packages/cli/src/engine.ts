import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BlueprintSource, EngineDeps, HookConsent } from '@atarashi/core';
import { clack } from './wizard.js';

let cachedVersion: string | undefined;

/** Reads the CLI's own version — works from `src` in dev and `dist` once built. */
export function cliVersion(): string {
    if (cachedVersion) return cachedVersion;
    const here = dirname(fileURLToPath(import.meta.url));
    const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8')) as {
        version: string;
    };
    cachedVersion = pkg.version;
    return cachedVersion;
}

/**
 * Doc 09 (T2): first-party and explicitly-trusted blueprints run hooks by
 * default; anything else needs consent, once, per run. Non-interactive runs
 * (`--yes`, no TTY, `--no-hooks`) deny by default rather than blocking.
 */
export function makeHookConsent(options: {
    interactive: boolean;
    onDenied?: (blueprintId: string, hook: string) => void;
}): HookConsent {
    return async ({ blueprint, hook }) => {
        if (blueprint.trusted) return true;
        if (!options.interactive) {
            options.onDenied?.(blueprint.manifest.id, hook);
            return false;
        }
        const allowed = await clack.confirm({
            message: `${blueprint.manifest.id} wants to run a generation hook (${hook}). Allow?`,
            initialValue: false,
        });
        if (clack.isCancel(allowed)) return false;
        return allowed;
    };
}

export interface EngineDepsOptions {
    hooks?: boolean;
    interactive?: boolean;
    now?: () => Date;
    onHookDenied?: (blueprintId: string, hook: string) => void;
}

export function buildEngineDeps(
    source: BlueprintSource,
    options: EngineDepsOptions = {}
): EngineDeps {
    return {
        source,
        atarashiVersion: cliVersion(),
        now: options.now,
        hooks: {
            enabled: options.hooks ?? true,
            consent: makeHookConsent({
                interactive: options.interactive ?? false,
                onDenied: options.onHookDenied,
            }),
        },
    };
}
