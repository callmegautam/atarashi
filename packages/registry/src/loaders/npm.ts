import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { BlueprintSummary, LoadedBlueprint } from '@atarashi/core';
import { DIAGNOSTIC_CODES } from '@atarashi/schema';
import { RegistryError } from '../errors.js';
import { loadBlueprintDir, summarize } from './directory.js';

export const NPM_PREFIX = 'npm:';
export const NPM_PACKAGE_PATTERN = /^(?:@[a-z0-9-~][a-z0-9-._~]*\/)?atarashi-blueprint-[a-z0-9-]+$/;

/** `npm:atarashi-blueprint-redis` → `atarashi-blueprint-redis`. */
export const parseNpmSpec = (spec: string): string | undefined =>
    spec.startsWith(NPM_PREFIX) ? spec.slice(NPM_PREFIX.length) : undefined;

/**
 * A community blueprint published to npm. The package's `atarashi` field points
 * at the directory holding its `blueprint.json`; everything else about it is
 * treated as hostile — untrusted, so hooks require explicit consent.
 */
export class NpmSource {
    private readonly cache = new Map<string, LoadedBlueprint>();
    private resolved: Map<string, LoadedBlueprint> | undefined;

    constructor(
        private readonly cwd: string,
        private readonly packages: string[] = []
    ) {}

    /** Adds a package for this run, e.g. from `--add npm:atarashi-blueprint-redis`. */
    add(spec: string): this {
        const name = parseNpmSpec(spec) ?? spec;
        if (!this.packages.includes(name)) {
            this.packages.push(name);
            this.resolved = undefined;
        }
        return this;
    }

    private async loadPackage(name: string): Promise<LoadedBlueprint> {
        const existing = this.cache.get(name);
        if (existing) return existing;

        if (!NPM_PACKAGE_PATTERN.test(name)) {
            throw new RegistryError(
                DIAGNOSTIC_CODES.UNKNOWN_BLUEPRINT,
                `\`${name}\` is not a blueprint package name`,
                {
                    suggestions: [
                        'Community blueprint packages are named `atarashi-blueprint-<name>`',
                    ],
                }
            );
        }

        const require_ = createRequire(pathToFileURL(join(this.cwd, 'noop.js')));
        let packageJsonPath: string;
        try {
            packageJsonPath = require_.resolve(`${name}/package.json`);
        } catch {
            throw new RegistryError(
                DIAGNOSTIC_CODES.UNKNOWN_BLUEPRINT,
                `\`${name}\` is not installed in ${this.cwd}`,
                { suggestions: [`Install it first: \`npm install ${name}\``] }
            );
        }

        const packageRoot = dirname(packageJsonPath);
        const packageJson = JSON.parse(await readFile(packageJsonPath, 'utf8')) as {
            atarashi?: string;
            version?: string;
        };
        if (!packageJson.atarashi) {
            throw new RegistryError(
                DIAGNOSTIC_CODES.SCHEMA_INVALID,
                `\`${name}\` has no \`atarashi\` field pointing at its blueprint`,
                { suggestions: ['Add `"atarashi": "./blueprint"` to the package'] }
            );
        }

        const dir = resolve(packageRoot, packageJson.atarashi);
        if (!dir.startsWith(packageRoot) || !existsSync(dir)) {
            throw new RegistryError(
                DIAGNOSTIC_CODES.SCHEMA_INVALID,
                `\`${name}\` points its \`atarashi\` field outside the package`
            );
        }

        const blueprint = await loadBlueprintDir(dir, {
            trusted: false,
            origin: `npm:${name}@${packageJson.version ?? 'unknown'}`,
        });
        this.cache.set(name, blueprint);
        return blueprint;
    }

    private async all(): Promise<Map<string, LoadedBlueprint>> {
        if (this.resolved) return this.resolved;
        const map = new Map<string, LoadedBlueprint>();
        for (const name of this.packages) {
            const blueprint = await this.loadPackage(name);
            map.set(blueprint.manifest.id, blueprint);
        }
        this.resolved = map;
        return map;
    }

    async load(id: string): Promise<LoadedBlueprint | undefined> {
        const name = parseNpmSpec(id);
        if (name) return this.loadPackage(name);
        return (await this.all()).get(id);
    }

    async summaries(): Promise<BlueprintSummary[]> {
        return [...(await this.all()).values()].map((entry) => summarize(entry.manifest));
    }
}
