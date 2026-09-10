import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { createRegistry, type Registry } from '@atarashi/registry';
import type { UserConfig } from '@atarashi/schema';

export interface RegistryFlags {
    cwd: string;
    offline?: boolean;
    registry?: string;
    npmPackages?: string[];
}

const isVersion = (value: string): boolean => /^\d+\.\d+\.\d+/.test(value);

/**
 * `@atarashi/registry`'s own bundled-source lookup does a bare
 * `require.resolve('@atarashi/blueprints/package.json')`, which only finds
 * anything in a flat/hoisted `node_modules` — the shape a real npm install of
 * `atarashi` produces, since `@atarashi/blueprints` is one of *its*
 * dependencies. It does not find anything under pnpm's strict, per-package
 * `node_modules`, where only a package that actually declares the dependency
 * gets the symlink. This CLI does declare it, so resolving from here (instead
 * of leaving it to the registry package) works in both layouts.
 */
function resolveBundledDir(): string | undefined {
    try {
        const require_ = createRequire(import.meta.url);
        return dirname(require_.resolve('@atarashi/blueprints/package.json'));
    } catch {
        return undefined;
    }
}

/**
 * One place builds the `Registry` every command talks to, so `--offline`,
 * `--registry` and the user's saved sources all apply the same way everywhere.
 */
export function buildRegistry(flags: RegistryFlags, userConfig: UserConfig): Registry {
    const pinned = flags.registry && isVersion(flags.registry) ? flags.registry : undefined;
    const url = flags.registry && !pinned ? flags.registry : undefined;

    return createRegistry({
        cwd: flags.cwd,
        offline: flags.offline,
        pin: pinned ?? userConfig.registry?.pin ?? null,
        url,
        sources: userConfig.registry?.sources,
        npmPackages: flags.npmPackages,
        bundledDir: resolveBundledDir(),
    });
}
