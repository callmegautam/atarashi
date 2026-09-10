import { mkdir, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createBundledSource, readBundledVersionManifest } from '../src/loaders/bundled.js';
import { DirectorySource, loadBlueprintDir } from '../src/loaders/directory.js';
import { createLocalSource } from '../src/loaders/local.js';
import { NpmSource, parseNpmSpec } from '../src/loaders/npm.js';
import { tempDir, writeBlueprint } from './helpers.js';

describe('loadBlueprintDir', () => {
    it('parses the manifest and reads files relative to the blueprint root', async () => {
        const root = await tempDir();
        const dir = await writeBlueprint(
            root,
            { id: 'db/postgres', provides: ['database'] },
            { 'files/src/db.ts': 'export const db = 1;\n' }
        );

        const blueprint = await loadBlueprintDir(dir, { trusted: true });
        expect(blueprint.manifest.id).toBe('db/postgres');
        expect(blueprint.trusted).toBe(true);
        expect((await blueprint.readFile('files/src/db.ts')).toString()).toBe(
            'export const db = 1;\n'
        );
    });

    it('reports a manifest that fails schema validation, with the path', async () => {
        const root = await tempDir();
        const dir = join(root, 'bad');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'blueprint.json'), JSON.stringify({ manifestVersion: 1 }));

        await expect(loadBlueprintDir(dir, { trusted: false })).rejects.toThrow(
            /blueprint manifest/
        );
    });

    it('reports a manifest that is not JSON at all', async () => {
        const root = await tempDir();
        const dir = join(root, 'bad');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'blueprint.json'), '{');

        await expect(loadBlueprintDir(dir, { trusted: false })).rejects.toThrow(/not valid JSON/);
    });

    it('says which file is missing when there is no manifest', async () => {
        await expect(loadBlueprintDir(await tempDir(), { trusted: false })).rejects.toThrow(
            /No `blueprint\.json`/
        );
    });

    // Security boundary: a blueprint's own file paths are attacker-controlled.
    it('refuses to read outside its own directory', async () => {
        const root = await tempDir();
        const dir = await writeBlueprint(root, { id: 'db/postgres' });
        await writeFile(join(root, 'secret.txt'), 'shh');

        const blueprint = await loadBlueprintDir(dir, { trusted: true });
        await expect(blueprint.readFile('../../../secret.txt')).rejects.toThrow(/outside/);
        await expect(blueprint.readFile('/etc/passwd')).rejects.toThrow(/must be relative/);
        await expect(blueprint.readFile('bad\0.txt')).rejects.toThrow(/null byte/);
    });

    it('refuses to follow a symlink out of the blueprint', async () => {
        const root = await tempDir();
        const dir = await writeBlueprint(root, { id: 'db/postgres' });
        await writeFile(join(root, 'secret.txt'), 'shh');
        await symlink(join(root, 'secret.txt'), join(dir, 'leak.txt'));

        const blueprint = await loadBlueprintDir(dir, { trusted: true });
        await expect(blueprint.readFile('leak.txt')).rejects.toThrow(/symlink/);
    });
});

describe('DirectorySource', () => {
    it('discovers namespace/name trees and ignores everything else', async () => {
        const root = await tempDir();
        await writeBlueprint(root, { id: 'db/postgres', provides: ['database'] });
        await writeBlueprint(root, { id: 'http/express', provides: ['http'] });
        await mkdir(join(root, 'db', 'not-a-blueprint'), { recursive: true });
        await writeFile(join(root, 'loose.txt'), 'x');

        const source = new DirectorySource(root, { trusted: true });
        expect(await source.ids()).toEqual(['db/postgres', 'http/express']);
        expect(await source.has('db/postgres')).toBe(true);
        expect(await source.load('db/mysql')).toBeUndefined();

        const summaries = await source.summaries();
        expect(summaries.map((entry) => entry.provides)).toEqual([['database'], ['http']]);
    });

    it('is empty, not broken, when the directory does not exist', async () => {
        const source = new DirectorySource(join(await tempDir(), 'nope'), { trusted: true });
        expect(await source.ids()).toEqual([]);
        expect(await source.load('db/postgres')).toBeUndefined();
    });

    it('loads presets by bare or prefixed id', async () => {
        const root = await tempDir();
        const presets = join(root, 'presets');
        await mkdir(presets, { recursive: true });
        await writeFile(
            join(presets, 'backend-ts.json'),
            JSON.stringify({
                manifestVersion: 1,
                kind: 'preset',
                id: 'preset/backend-ts',
                name: 'Backend TS',
                description: 'A backend',
                blueprints: ['core/node-ts'],
            })
        );

        const source = new DirectorySource(join(root, 'blueprints'), {
            trusted: true,
            presetsDir: presets,
        });
        expect((await source.loadPreset('preset/backend-ts'))?.blueprints).toEqual([
            'core/node-ts',
        ]);
        expect(await source.loadPreset('preset/missing')).toBeUndefined();
        expect(await source.presets()).toHaveLength(1);
    });
});

describe('local source', () => {
    it('reads ./.atarashi/blueprints and marks them untrusted', async () => {
        const cwd = await tempDir();
        await writeBlueprint(join(cwd, '.atarashi', 'blueprints'), { id: 'db/postgres' });

        const source = createLocalSource(cwd);
        const blueprint = await source.load('db/postgres');
        expect(blueprint?.trusted).toBe(false);
        expect(blueprint?.origin).toContain('local:');
    });
});

describe('npm source', () => {
    const packageJson = (name: string, extra: Record<string, unknown> = {}) =>
        JSON.stringify({ name, version: '1.0.0', main: 'index.js', ...extra });

    async function installPackage(
        cwd: string,
        name: string,
        options: { atarashi?: string; blueprintId?: string } = {}
    ) {
        const dir = join(cwd, 'node_modules', name);
        await mkdir(dir, { recursive: true });
        await writeFile(
            join(dir, 'package.json'),
            packageJson(name, options.atarashi === undefined ? {} : { atarashi: options.atarashi })
        );
        if (options.blueprintId) {
            const blueprintDir = join(dir, 'blueprint');
            await mkdir(blueprintDir, { recursive: true });
            await writeFile(
                join(blueprintDir, 'blueprint.json'),
                JSON.stringify({
                    manifestVersion: 1,
                    id: options.blueprintId,
                    name: options.blueprintId,
                    version: '1.0.0',
                    description: 'A community blueprint',
                    category: 'cache',
                    provides: ['cache'],
                })
            );
        }
        return dir;
    }

    it('parses npm specs', () => {
        expect(parseNpmSpec('npm:atarashi-blueprint-redis')).toBe('atarashi-blueprint-redis');
        expect(parseNpmSpec('db/postgres')).toBeUndefined();
    });

    it('loads a community package by spec and by the id it declares', async () => {
        const cwd = await tempDir();
        await installPackage(cwd, 'atarashi-blueprint-redis', {
            atarashi: './blueprint',
            blueprintId: 'db/redis',
        });

        const source = new NpmSource(cwd, ['atarashi-blueprint-redis']);
        const bySpec = await source.load('npm:atarashi-blueprint-redis');
        expect(bySpec?.manifest.id).toBe('db/redis');
        // Never trusted: hooks from npm need explicit consent (doc 09, T2).
        expect(bySpec?.trusted).toBe(false);
        expect(bySpec?.origin).toBe('npm:atarashi-blueprint-redis@1.0.0');

        expect((await source.load('db/redis'))?.manifest.id).toBe('db/redis');
        expect((await source.summaries())[0]?.provides).toEqual(['cache']);
    });

    it('refuses package names outside the blueprint namespace', async () => {
        const source = new NpmSource(await tempDir());
        await expect(source.load('npm:left-pad')).rejects.toThrow(/not a blueprint package name/);
    });

    it('says how to install a package that is not there', async () => {
        const source = new NpmSource(await tempDir());
        await expect(source.load('npm:atarashi-blueprint-redis')).rejects.toThrow(/not installed/);
    });

    it('requires the `atarashi` field', async () => {
        const cwd = await tempDir();
        await installPackage(cwd, 'atarashi-blueprint-redis');
        const source = new NpmSource(cwd, ['atarashi-blueprint-redis']);
        await expect(source.load('db/redis')).rejects.toThrow(/no `atarashi` field/);
    });

    it('refuses an `atarashi` field pointing outside the package', async () => {
        const cwd = await tempDir();
        await installPackage(cwd, 'atarashi-blueprint-redis', { atarashi: '../../../etc' });
        const source = new NpmSource(cwd, ['atarashi-blueprint-redis']);
        await expect(source.load('db/redis')).rejects.toThrow(/outside the package/);
    });
});

describe('bundled source', () => {
    it('exposes blueprints, presets and the version manifest from the package', async () => {
        const root = await tempDir();
        await writeBlueprint(join(root, 'blueprints'), { id: 'core/node-ts' });
        await writeFile(
            join(root, 'version-manifest.json'),
            JSON.stringify({
                version: '1.0.0',
                updatedAt: '2026-01-01T00:00:00.000Z',
                packages: { express: '^5.1.0' },
            })
        );

        const bundled = createBundledSource(root);
        expect(bundled).toBeDefined();
        expect((await bundled!.source.load('core/node-ts'))?.trusted).toBe(true);
        expect(await readBundledVersionManifest(bundled!.versionManifestPath)).toEqual({
            express: '^5.1.0',
        });
    });

    it('is absent rather than throwing when the collection is not installed', async () => {
        expect(createBundledSource(join(await tempDir(), 'missing'))).toBeUndefined();
        expect(await readBundledVersionManifest('/nowhere/version-manifest.json')).toBeUndefined();
    });
});
