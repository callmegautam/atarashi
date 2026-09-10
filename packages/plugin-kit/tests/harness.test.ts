import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
    Catalogue,
    defineBlueprint,
    definePreset,
    dependencyRange,
    expectPlan,
    FIXED_VERSION,
    fileAt,
    hasFile,
    makeSpec,
    planFor,
    specForPreset,
    toManifestJson,
} from '../src/index.js';

/**
 * A two-blueprint catalogue laid out exactly as `@atarashi/blueprints` ships,
 * built here rather than imported so the harness is tested without depending
 * on the first-party collection.
 */
let root: string;
let catalogue: Catalogue;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'atarashi-cat-'));

    const write = async (path: string, contents: string) => {
        const full = join(root, path);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, contents);
    };

    await write(
        'blueprints/core/node-ts/blueprint.json',
        toManifestJson(
            defineBlueprint({
                id: 'core/node-ts',
                name: 'Node + TypeScript',
                version: '1.0.0',
                description: 'A TypeScript Node project.',
                category: 'core',
                provides: ['runtime:node', 'language:typescript'],
                priority: 0,
                files: [{ from: 'files/src/index.ts.hbs', to: 'src/index.ts' }],
                devDependencies: { typescript: {} },
                scripts: { build: 'tsc' },
            })
        )
    );
    await write(
        'blueprints/core/node-ts/files/src/index.ts.hbs',
        'export const name = "{{ project.slug }}";\n'
    );

    await write(
        'blueprints/db/redis/blueprint.json',
        toManifestJson(
            defineBlueprint({
                id: 'db/redis',
                name: 'Redis',
                version: '1.2.0',
                description: 'A Redis connection helper.',
                category: 'database',
                provides: ['cache'],
                requires: ['runtime:node'],
                files: [{ from: 'files/src/redis.ts.hbs', to: 'src/redis.ts' }],
                dependencies: { ioredis: '^5.4.1' },
                env: [{ key: 'REDIS_URL', sample: 'redis://localhost:6379' }],
            })
        )
    );
    await write(
        'blueprints/db/redis/files/src/redis.ts.hbs',
        'export const url = process.env.REDIS_URL;\n'
    );

    await write(
        'presets/cached-api.json',
        `${JSON.stringify(
            definePreset({
                id: 'preset/cached-api',
                name: 'Cached API',
                description: 'Node with a Redis cache.',
                blueprints: ['core/node-ts', 'db/redis'],
            }),
            null,
            2
        )}\n`
    );

    await write(
        'version-manifest.json',
        `${JSON.stringify({ version: '1.0.0', packages: { typescript: '^5.9.3' } }, null, 2)}\n`
    );

    catalogue = new Catalogue(root);
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('Catalogue', () => {
    it('lists the blueprints it holds', async () => {
        expect(await catalogue.ids()).toEqual(['core/node-ts', 'db/redis']);
    });

    it('loads a blueprint by id', async () => {
        const loaded = await catalogue.load('db/redis');
        expect(loaded?.manifest.version).toBe('1.2.0');
    });

    it('returns undefined for a blueprint it does not have', async () => {
        expect(await catalogue.load('db/nope')).toBeUndefined();
    });

    it('finds providers of a capability', async () => {
        const providers = await catalogue.providersOf('runtime:node');
        expect(providers.map((provider) => provider.id)).toEqual(['core/node-ts']);
    });

    it('reads the shared version manifest, and caches it', async () => {
        expect(await catalogue.versionManifest()).toEqual({ typescript: '^5.9.3' });
        expect(await catalogue.versionManifest()).toEqual({ typescript: '^5.9.3' });
    });

    it('loads presets by id and in bulk', async () => {
        expect((await catalogue.loadPreset('preset/cached-api'))?.name).toBe('Cached API');
        expect((await catalogue.presets()).map((preset) => preset.id)).toEqual([
            'preset/cached-api',
        ]);
    });
});

describe('makeSpec', () => {
    it('produces a fully-defaulted spec from just ids', () => {
        const spec = makeSpec(['core/node-ts']);
        expect(spec.specVersion).toBe(1);
        expect(spec.name).toBe('my-app');
        expect(spec.options.packageManager).toBe('pnpm');
        expect(spec.options.license).toBe('MIT');
        expect(spec.blueprints).toEqual([{ id: 'core/node-ts', reason: 'user' }]);
    });

    it('lets a caller opt out of a license explicitly', () => {
        expect(makeSpec([], { license: null }).options.license).toBeNull();
    });

    it('carries the overrides it is given', () => {
        const spec = makeSpec(['db/redis'], {
            name: 'cache-api',
            description: 'Fast',
            packageManager: 'bun',
            answers: { 'redis.tls': true },
        });
        expect(spec.name).toBe('cache-api');
        expect(spec.description).toBe('Fast');
        expect(spec.options.packageManager).toBe('bun');
        expect(spec.answers).toEqual({ 'redis.tls': true });
    });
});

describe('specForPreset', () => {
    it('expands a preset the way `--preset` does', async () => {
        const spec = await specForPreset(catalogue, 'preset/cached-api');
        expect(spec.preset).toBe('preset/cached-api');
        expect(spec.blueprints.map((entry) => entry.id)).toEqual(['core/node-ts', 'db/redis']);
        expect(spec.blueprints.every((entry) => entry.reason === 'preset')).toBe(true);
    });

    it('throws for a preset that does not exist', async () => {
        await expect(specForPreset(catalogue, 'preset/nope')).rejects.toThrow(/Unknown preset/);
    });
});

describe('planFor and expectPlan', () => {
    it('generates a plan with output stamped at the fixed version', async () => {
        const plan = await expectPlan(catalogue, makeSpec(['core/node-ts', 'db/redis']));
        expect(plan.summary.blueprints.map((entry) => entry.id)).toEqual([
            'core/node-ts',
            'db/redis',
        ]);
        expect(fileAt(plan, 'package.json')).toContain(FIXED_VERSION.slice(0, 1));
    });

    it('renders templates against the project facts', async () => {
        const plan = await expectPlan(catalogue, makeSpec(['core/node-ts'], { name: 'My App' }));
        expect(fileAt(plan, 'src/index.ts')).toBe('export const name = "my-app";\n');
    });

    it('is deterministic — the same spec twice produces identical output', async () => {
        const spec = makeSpec(['core/node-ts', 'db/redis']);
        const [first, second] = await Promise.all([
            expectPlan(catalogue, spec),
            expectPlan(catalogue, spec),
        ]);
        expect(first.files.map((file) => [file.path, file.contents])).toEqual(
            second.files.map((file) => [file.path, file.contents])
        );
    });

    it('returns a failed result for an unsatisfiable spec', async () => {
        const result = await planFor(catalogue, makeSpec(['db/nope']));
        expect(result.ok).toBe(false);
    });

    it('throws with the diagnostics attached when a plan cannot be built', async () => {
        await expect(expectPlan(catalogue, makeSpec(['db/nope']))).rejects.toThrow(/db\/nope/);
    });
});

describe('plan assertions', () => {
    it('finds a file and reports the ones it has when it cannot', async () => {
        const plan = await expectPlan(catalogue, makeSpec(['core/node-ts']));
        expect(hasFile(plan, 'src/index.ts')).toBe(true);
        expect(hasFile(plan, 'src/missing.ts')).toBe(false);
        expect(() => fileAt(plan, 'src/missing.ts')).toThrow(/src\/index\.ts/);
    });

    it('resolves a dependency range from either group', async () => {
        const plan = await expectPlan(catalogue, makeSpec(['core/node-ts', 'db/redis']));
        expect(dependencyRange(plan, 'ioredis')).toBe('^5.4.1');
        // Ranges with no `version` come from the shared version manifest.
        expect(dependencyRange(plan, 'typescript')).toBe('^5.9.3');
        expect(dependencyRange(plan, 'not-installed')).toBeUndefined();
    });
});
