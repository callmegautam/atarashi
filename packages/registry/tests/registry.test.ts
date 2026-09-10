import { join } from 'node:path';
import { generate } from '@atarashi/core';
import { describe, expect, it } from 'vitest';
import { createRegistry } from '../src/registry.js';
import { makeIndex, packDir, stubFetch, tempDir, writeBlueprint } from './helpers.js';

const URL_ = 'https://registry.example.dev';

interface Fixture {
    cwd: string;
    cacheDir: string;
    bundledDir: string;
}

async function fixture(): Promise<Fixture> {
    const root = await tempDir();
    return {
        cwd: join(root, 'project'),
        cacheDir: join(root, 'cache'),
        bundledDir: join(root, 'bundled'),
    };
}

/** A packed blueprint, ready to be served by the stub registry. */
async function tarballFor(id: string, version: string, files: Record<string, string> = {}) {
    const dir = await writeBlueprint(await tempDir(), { id, version }, files);
    return packDir(dir);
}

describe('layer precedence', () => {
    it('prefers a project-local blueprint over everything else', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(cwd, '.atarashi', 'blueprints'), {
            id: 'db/postgres',
            version: '0.0.1',
        });
        await writeBlueprint(join(bundledDir, 'blueprints'), {
            id: 'db/postgres',
            version: '9.9.9',
        });

        const registry = createRegistry({ cwd, cacheDir, bundledDir, offline: true });
        const loaded = await registry.load('db/postgres');

        expect(loaded?.manifest.version).toBe('0.0.1');
        expect(await registry.originOf('db/postgres')).toBe('local');
    });

    it('uses the bundled copy when the registry has nothing newer', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(bundledDir, 'blueprints'), {
            id: 'db/postgres',
            version: '1.2.0',
        });

        const { impl, calls } = stubFetch(
            makeIndex([
                {
                    id: 'db/postgres',
                    version: '1.2.0',
                    tarball: await tarballFor('db/postgres', '1.2.0'),
                },
            ])
        );

        const registry = createRegistry({ cwd, cacheDir, bundledDir, url: URL_, fetchImpl: impl });
        const loaded = await registry.load('db/postgres');

        expect(loaded?.origin).toBe('bundled');
        // The index was consulted; the tarball was not downloaded.
        expect(calls.filter((call) => call.url.includes('.tgz'))).toEqual([]);
    });

    it('downloads a newer registry version than the bundled one', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(bundledDir, 'blueprints'), {
            id: 'db/postgres',
            version: '1.2.0',
        });

        const { impl } = stubFetch(
            makeIndex([
                {
                    id: 'db/postgres',
                    version: '1.3.0',
                    tarball: await tarballFor('db/postgres', '1.3.0'),
                },
            ])
        );

        const registry = createRegistry({ cwd, cacheDir, bundledDir, url: URL_, fetchImpl: impl });
        const loaded = await registry.load('db/postgres');

        expect(loaded?.manifest.version).toBe('1.3.0');
        expect(loaded?.origin).toBe('registry:db/postgres@1.3.0');
        expect(await registry.originOf('db/postgres')).toBe('registry');
    });

    it('trusts the default registry but not a third-party source', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        const { impl } = stubFetch(
            makeIndex([{ id: 'db/redis', tarball: await tarballFor('db/redis', '1.0.0') }])
        );

        const trusted = createRegistry({ cwd, cacheDir, bundledDir, url: URL_, fetchImpl: impl });
        expect((await trusted.load('db/redis'))?.trusted).toBe(true);

        const community = createRegistry({
            cwd,
            cacheDir: `${cacheDir}-2`,
            bundledDir,
            fetchImpl: impl,
            sources: [{ name: 'community', url: URL_, trusted: false, enabled: true }],
        });
        expect((await community.load('db/redis'))?.trusted).toBe(false);
    });

    it('falls back to the bundled copy when a download fails', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(bundledDir, 'blueprints'), {
            id: 'db/postgres',
            version: '1.2.0',
        });

        const index = makeIndex([
            {
                id: 'db/postgres',
                version: '1.3.0',
                tarball: await tarballFor('db/postgres', '1.3.0'),
            },
        ]);
        const serveIndexOnly = async (url: string) =>
            url.endsWith('index.json')
                ? new Response(JSON.stringify(index.index))
                : new Response('gone', { status: 502 });

        const registry = createRegistry({
            cwd,
            cacheDir,
            bundledDir,
            url: URL_,
            fetchImpl: serveIndexOnly,
        });
        expect((await registry.load('db/postgres'))?.manifest.version).toBe('1.2.0');
    });

    it('never falls back when a tarball fails its integrity check', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(bundledDir, 'blueprints'), {
            id: 'db/postgres',
            version: '1.2.0',
        });

        const index = makeIndex([
            {
                id: 'db/postgres',
                version: '1.3.0',
                tarball: await tarballFor('db/postgres', '1.3.0'),
            },
        ]);
        const tampered = async (url: string) =>
            url.endsWith('index.json')
                ? new Response(JSON.stringify(index.index))
                : new Response(await tarballFor('db/postgres', '6.6.6'));

        const registry = createRegistry({
            cwd,
            cacheDir,
            bundledDir,
            url: URL_,
            fetchImpl: tampered,
        });
        await expect(registry.load('db/postgres')).rejects.toThrow(/Integrity check failed/);
    });
});

describe('discovery', () => {
    it('merges every layer, deduplicating by id', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(bundledDir, 'blueprints'), {
            id: 'db/postgres',
            version: '1.0.0',
            provides: ['database', 'database:sql'],
        });
        await writeBlueprint(join(bundledDir, 'blueprints'), {
            id: 'http/express',
            provides: ['http'],
        });
        await writeBlueprint(join(cwd, '.atarashi', 'blueprints'), {
            id: 'db/mysql',
            provides: ['database', 'database:sql'],
        });

        const { impl } = stubFetch(
            makeIndex([
                {
                    id: 'db/postgres',
                    version: '2.0.0',
                    provides: ['database', 'database:sql'],
                    tarball: await tarballFor('db/postgres', '2.0.0'),
                },
                {
                    id: 'db/mongodb',
                    provides: ['database', 'database:document'],
                    tarball: await tarballFor('db/mongodb', '1.0.0'),
                },
            ])
        );

        const registry = createRegistry({ cwd, cacheDir, bundledDir, url: URL_, fetchImpl: impl });

        expect((await registry.list()).map((entry) => entry.id)).toEqual([
            'db/mongodb',
            'db/mysql',
            'db/postgres',
            'http/express',
        ]);
        // The registry's newer postgres wins the version comparison.
        expect((await registry.list()).find((e) => e.id === 'db/postgres')?.version).toBe('2.0.0');

        const sql = await registry.providersOf('database:sql');
        expect(sql.map((entry) => entry.id)).toEqual(['db/mysql', 'db/postgres']);
    });

    it('resolves the version manifest with the registry overriding the bundled one', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(bundledDir, 'blueprints'), { id: 'core/node-ts' });
        const { writeFile } = await import('node:fs/promises');
        await writeFile(
            join(bundledDir, 'version-manifest.json'),
            JSON.stringify({
                version: '1.0.0',
                updatedAt: '2026-01-01T00:00:00.000Z',
                packages: { express: '^5.0.0', zod: '^3.24.0' },
            })
        );

        const { impl } = stubFetch(makeIndex([], { packages: { express: '^5.1.0' } }));

        const registry = createRegistry({ cwd, cacheDir, bundledDir, url: URL_, fetchImpl: impl });
        expect(await registry.versionManifest()).toEqual({ express: '^5.1.0', zod: '^3.24.0' });
    });
});

describe('offline', () => {
    it('works entirely from bundled blueprints with no network at all', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(bundledDir, 'blueprints'), { id: 'core/node-ts' });

        const registry = createRegistry({
            cwd,
            cacheDir,
            bundledDir,
            offline: true,
            fetchImpl: async () => {
                throw new Error('the network must not be touched offline');
            },
        });

        expect((await registry.load('core/node-ts'))?.manifest.id).toBe('core/node-ts');
        expect(await registry.list()).toHaveLength(1);
        expect(await registry.pin()).toBeUndefined();
    });

    it('reads ATARASHI_OFFLINE from the environment', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        const registry = createRegistry({
            cwd,
            cacheDir,
            bundledDir,
            env: { ATARASHI_OFFLINE: '1' },
        });
        expect(registry.offline).toBe(true);
    });

    it('serves a registry blueprint from the cache once it has been downloaded', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        const { impl } = stubFetch(
            makeIndex([{ id: 'db/redis', tarball: await tarballFor('db/redis', '1.0.0') }])
        );

        await createRegistry({ cwd, cacheDir, bundledDir, url: URL_, fetchImpl: impl }).load(
            'db/redis'
        );

        const offline = createRegistry({
            cwd,
            cacheDir,
            bundledDir,
            url: URL_,
            offline: true,
            fetchImpl: async () => {
                throw new Error('should not be called');
            },
        });
        expect((await offline.load('db/redis'))?.manifest.id).toBe('db/redis');
    });
});

describe('pinning and maintenance', () => {
    it('reports the exact version and root hash a run resolved against', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        const index = makeIndex(
            [{ id: 'db/redis', tarball: await tarballFor('db/redis', '1.0.0') }],
            {
                version: '1.4.2',
            }
        );
        const registry = createRegistry({
            cwd,
            cacheDir,
            bundledDir,
            url: URL_,
            fetchImpl: stubFetch(index).impl,
        });

        expect(await registry.pin()).toEqual({
            version: '1.4.2',
            integrity: index.index.integrity,
            source: URL_,
        });
    });

    it('regenerates from a pin without consulting the latest index', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        const index = makeIndex(
            [{ id: 'db/redis', version: '1.0.0', tarball: await tarballFor('db/redis', '1.0.0') }],
            { version: '1.4.2' }
        );
        const { impl, calls } = stubFetch(index);

        const registry = createRegistry({
            cwd,
            cacheDir,
            bundledDir,
            url: URL_,
            pin: '1.4.2',
            fetchImpl: impl,
        });
        expect((await registry.load('db/redis'))?.manifest.version).toBe('1.0.0');
        expect(calls[0]!.url).toBe(`${URL_}/v1/1.4.2/index.json`);
    });

    it('update, cachedVersions, verify and clear operate on the cache', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        const { impl } = stubFetch(
            makeIndex([{ id: 'db/redis', tarball: await tarballFor('db/redis', '1.0.0') }], {
                version: '1.4.2',
            })
        );
        const registry = createRegistry({ cwd, cacheDir, bundledDir, url: URL_, fetchImpl: impl });

        expect(await registry.update()).toEqual([
            { name: 'atarashi', version: '1.4.2', from: 'network' },
        ]);
        expect(await registry.cachedVersions()).toEqual(['1.4.2']);
        expect((await registry.verifyCache()).removed).toEqual([]);

        await registry.clearCache();
        expect(await registry.cachedVersions()).toEqual([]);
    });
});

describe('end to end with the generation engine', () => {
    const spec = {
        specVersion: 1,
        name: 'my-api',
        blueprints: [{ id: 'core/node-ts', reason: 'user' as const }],
        answers: {},
        options: {
            packageManager: 'pnpm' as const,
            git: true,
            install: true,
            format: true,
            initialCommit: true,
            license: 'MIT',
            author: null,
            writeEnv: false,
            force: false,
        },
    };

    const blueprint = {
        id: 'core/node-ts',
        provides: ['runtime:node', 'language:ts'],
        files: [{ from: 'files/src/index.ts.hbs', to: 'src/index.ts' }],
        dependencies: { express: { fromVersionManifest: true } },
    };

    const template = 'export const name = "{{ project.name }}";\n';

    it('generates a real project from bundled blueprints, offline', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        await writeBlueprint(join(bundledDir, 'blueprints'), blueprint, {
            'files/src/index.ts.hbs': template,
        });
        const { writeFile } = await import('node:fs/promises');
        await writeFile(
            join(bundledDir, 'version-manifest.json'),
            JSON.stringify({
                version: '1.0.0',
                updatedAt: '2026-01-01T00:00:00.000Z',
                packages: { express: '^5.1.0' },
            })
        );

        const registry = createRegistry({ cwd, cacheDir, bundledDir, offline: true });
        const result = await generate(spec, { source: registry, atarashiVersion: '1.0.0' });

        expect(result.ok).toBe(true);
        if (!result.ok) return;

        const file = result.value.files.find((entry) => entry.path === 'src/index.ts');
        expect(file?.contents.toString()).toBe('export const name = "my-api";\n');
        expect(result.value.summary.deps.dependencies).toContainEqual({
            name: 'express',
            range: '^5.1.0',
            dev: false,
            requestedBy: ['core/node-ts'],
        });
    });

    it('generates the same project from the remote registry, online', async () => {
        const { cwd, cacheDir, bundledDir } = await fixture();
        const dir = await writeBlueprint(await tempDir(), blueprint, {
            'files/src/index.ts.hbs': template,
        });
        const { impl } = stubFetch(
            makeIndex([{ id: 'core/node-ts', tarball: await packDir(dir) }], {
                packages: { express: '^5.1.0' },
            })
        );

        const registry = createRegistry({ cwd, cacheDir, bundledDir, url: URL_, fetchImpl: impl });
        const result = await generate(spec, { source: registry, atarashiVersion: '1.0.0' });

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(
            result.value.files.find((entry) => entry.path === 'src/index.ts')?.contents.toString()
        ).toBe('export const name = "my-api";\n');
        expect(result.value.summary.deps.dependencies).toContainEqual({
            name: 'express',
            range: '^5.1.0',
            dev: false,
            requestedBy: ['core/node-ts'],
        });
    });
});
