import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, rm, rmdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import { type EngineDeps, generate, normalizeProjectPath } from '@atarashi/core';
import type { Registry } from '@atarashi/registry';
import {
    type GenerationPlan,
    type ProjectConfig,
    type ProjectSpec,
    parseProjectConfig,
    type SelectedBlueprint,
} from '@atarashi/schema';
import { CliUsageError } from './errors.js';
import type { Reconciled } from './reconcile.js';

export const CONFIG_FILE = 'atarashi.json';

export async function readProjectConfig(cwd: string): Promise<ProjectConfig> {
    const configPath = join(cwd, CONFIG_FILE);
    if (!existsSync(configPath)) {
        throw new CliUsageError('No `atarashi.json` in this directory', [
            'Run `atarashi new` first, or `cd` into a generated project',
        ]);
    }
    const result = parseProjectConfig(JSON.parse(await readFile(configPath, 'utf8')), configPath);
    if (!result.ok) throw result.error;
    return result.value;
}

/**
 * The spec that reproduces a project from its `atarashi.json`. Every recorded
 * blueprint comes back as a `user` selection: the file does not say which ones
 * the resolver added, and re-selecting an auto-added one changes nothing.
 */
export function specFromConfig(config: ProjectConfig): ProjectSpec {
    return {
        specVersion: config.specVersion,
        name: config.name,
        description: config.description,
        registry: config.registry,
        preset: config.preset,
        blueprints: config.blueprints.map(
            (blueprint): SelectedBlueprint => ({ id: blueprint.id, reason: 'user' })
        ),
        answers: config.answers,
        options: {
            packageManager: 'pnpm',
            git: true,
            install: true,
            format: true,
            initialCommit: true,
            license: 'MIT',
            author: null,
            writeEnv: false,
            force: false,
            ...config.options,
        },
    };
}

/** Engine deps that render exactly as the version that wrote `atarashi.json` did. */
export function pinnedDeps(
    deps: EngineDeps,
    config: ProjectConfig,
    source: Registry,
    atarashiVersion = config.atarashiVersion
): EngineDeps {
    const generatedAt = new Date(config.generatedAt);
    return { ...deps, source, atarashiVersion, now: () => generatedAt };
}

export async function plan(spec: ProjectSpec, deps: EngineDeps): Promise<GenerationPlan> {
    const result = await generate(spec, deps);
    if (!result.ok) throw result.error;
    return result.value;
}

/** Recorded blueprints whose version the baseline render could not reproduce. */
export function unverifiedBlueprints(config: ProjectConfig, baseline: GenerationPlan): Set<string> {
    const rendered = new Map(baseline.summary.blueprints.map((entry) => [entry.id, entry.version]));
    return new Set(
        config.blueprints
            .filter((blueprint) => rendered.get(blueprint.id) !== blueprint.version)
            .map((blueprint) => blueprint.id)
    );
}

export const diskReader =
    (cwd: string) =>
    (path: string): Buffer | undefined => {
        const absolute = join(cwd, path);
        return existsSync(absolute) ? readFileSync(absolute) : undefined;
    };

/**
 * `atarashi.json` is the record of what produced the project, not a file the
 * user owns, so it always takes the target render.
 */
export function withConfigUpdate(changes: Reconciled[], target: GenerationPlan): Reconciled[] {
    const config = target.files.find((file) => file.path === CONFIG_FILE);
    if (!config) return changes;
    return changes.map((change) =>
        change.path === CONFIG_FILE && change.kind !== 'unchanged' && change.kind !== 'create'
            ? { path: CONFIG_FILE, kind: 'update', contents: config.contents, mode: config.mode }
            : change
    );
}

function inside(cwd: string, path: string): string {
    const destination = resolvePath(cwd, normalizeProjectPath(path));
    if (destination === cwd || !destination.startsWith(cwd + sep)) {
        throw new CliUsageError(`Refusing to write \`${path}\` outside the project`);
    }
    return destination;
}

/** Applies the writable changes. Directories a deletion leaves empty go too. */
export async function applyChanges(cwd: string, changes: Reconciled[]): Promise<void> {
    for (const change of changes) {
        const destination = inside(cwd, change.path);
        if (change.kind === 'delete') {
            await rm(destination, { force: true });
            let dir = dirname(destination);
            while (dir !== cwd && dir.startsWith(cwd + sep)) {
                try {
                    await rmdir(dir);
                } catch {
                    break;
                }
                dir = dirname(dir);
            }
            continue;
        }
        if (change.contents === undefined) continue;
        await mkdir(dirname(destination), { recursive: true });
        await writeFile(destination, change.contents, { mode: change.mode });
    }
}
