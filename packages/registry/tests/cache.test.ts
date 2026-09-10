import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegistryCache } from '../src/cache.js';
import { digest } from '../src/integrity.js';
import { cacheLayout, resolveCacheRoot } from '../src/paths.js';
import { makeIndex, packDir, tempDir, writeBlueprint } from './helpers.js';

const cacheIn = async () => new RegistryCache(join(await tempDir(), 'cache'));

async function blueprintTarball(id = 'db/postgres') {
    const root = await tempDir();
    const dir = await writeBlueprint(root, { id }, { 'files/index.ts': 'export {};\n' });
    return packDir(dir);
}

describe('resolveCacheRoot', () => {
    it('honours the explicit override above everything else', () => {
        expect(resolveCacheRoot({ ATARASHI_CACHE_DIR: '/tmp/x', XDG_CACHE_HOME: '/y' })).toBe(
            '/tmp/x'
        );
    });

    it('follows XDG on linux and the platform convention elsewhere', () => {
        expect(resolveCacheRoot({ XDG_CACHE_HOME: '/xdg' }, 'linux')).toBe('/xdg/atarashi');
        expect(resolveCacheRoot({ LOCALAPPDATA: 'C:\\local' }, 'win32')).toContain('atarashi');
        expect(resolveCacheRoot({}, 'darwin')).toContain(join('Library', 'Caches', 'atarashi'));
    });

    it('lays the cache out as index / blueprints / meta', () => {
        const layout = cacheLayout('/cache');
        expect(layout.index).toBe(join('/cache', 'index'));
        expect(layout.blueprints).toBe(join('/cache', 'blueprints'));
        expect(layout.meta).toBe(join('/cache', 'meta.json'));
    });
});

describe('index caching', () => {
    it('round-trips an index and verifies its root hash on read', async () => {
        const cache = await cacheIn();
        const { index } = makeIndex([{ id: 'db/postgres', tarball: Buffer.from('x') }]);

        await cache.writeIndex(index);
        expect(await cache.readIndex(index.version, 'test')).toEqual(index);
        expect(await cache.cachedIndexVersions()).toEqual(['1.0.0']);
    });

    it('refuses — and evicts — a cached index whose entries were tampered with', async () => {
        const cache = await cacheIn();
        const { index } = makeIndex([{ id: 'db/postgres', tarball: Buffer.from('x') }]);
        await cache.writeIndex(index);

        const path = cache.indexPath(index.version);
        const onDisk = JSON.parse(await readFile(path, 'utf8')) as typeof index;
        onDisk.entries[0]!.tarball = 'https://evil.example/payload.tgz';
        await writeFile(path, JSON.stringify(onDisk));

        await expect(cache.readIndex(index.version, 'test')).rejects.toThrow(/root hash/);
    });

    it('treats an unreadable index as a cold cache entry, not a crash', async () => {
        const cache = await cacheIn();
        await mkdir(cache.layout.index, { recursive: true });
        await writeFile(cache.indexPath('9.9.9'), 'not json');
        await expect(cache.readIndex('9.9.9', 'test')).rejects.toThrow(/unreadable/);
        expect(existsSync(cache.indexPath('9.9.9'))).toBe(false);
    });

    it('returns undefined for a version it has never seen', async () => {
        const cache = await cacheIn();
        expect(await cache.readIndex('2.0.0', 'test')).toBeUndefined();
    });
});

describe('blueprint caching', () => {
    it('names directories by content, so two versions never collide', async () => {
        const cache = await cacheIn();
        const a = cache.blueprintDir('db/postgres', '1.2.0', digest('a'));
        const b = cache.blueprintDir('db/postgres', '1.2.0', digest('b'));

        expect(a).not.toBe(b);
        expect(a).toContain('db-postgres-1.2.0-');
    });

    it('verifies, extracts and records a tarball', async () => {
        const cache = await cacheIn();
        const tarball = await blueprintTarball();
        const entry = { id: 'db/postgres', version: '1.2.0', integrity: digest(tarball) };

        const dir = await cache.storeBlueprint(entry, tarball);
        expect(existsSync(join(dir, 'blueprint.json'))).toBe(true);
        expect(cache.hasBlueprint(entry.id, entry.version, entry.integrity)).toBe(true);

        const meta = await cache.readMeta();
        expect(meta.blueprints['db/postgres@1.2.0']).toMatchObject({
            dir,
            integrity: entry.integrity,
        });
    });

    it('refuses a tarball whose hash does not match the index, leaving no directory', async () => {
        const cache = await cacheIn();
        const tarball = await blueprintTarball();
        const entry = { id: 'db/postgres', version: '1.2.0', integrity: digest('something else') };

        await expect(cache.storeBlueprint(entry, tarball)).rejects.toThrow(
            /Integrity check failed/
        );
        expect(existsSync(cache.blueprintDir(entry.id, entry.version, entry.integrity))).toBe(
            false
        );
    });

    it('refuses an archive with no manifest at its root', async () => {
        const cache = await cacheIn();
        const root = await tempDir();
        await writeFile(join(root, 'readme.md'), '# nope');
        const tarball = await packDir(root);

        await expect(
            cache.storeBlueprint(
                { id: 'db/nope', version: '1.0.0', integrity: digest(tarball) },
                tarball
            )
        ).rejects.toThrow(/blueprint\.json/);
    });

    it('is idempotent — a second store is a no-op hit', async () => {
        const cache = await cacheIn();
        const tarball = await blueprintTarball();
        const entry = { id: 'db/postgres', version: '1.2.0', integrity: digest(tarball) };

        const first = await cache.storeBlueprint(entry, tarball);
        const second = await cache.storeBlueprint(entry, tarball);
        expect(second).toBe(first);
    });
});

describe('maintenance', () => {
    it('verify prunes records whose directory has gone missing', async () => {
        const cache = await cacheIn();
        const tarball = await blueprintTarball();
        const entry = { id: 'db/postgres', version: '1.2.0', integrity: digest(tarball) };
        const dir = await cache.storeBlueprint(entry, tarball);

        expect((await cache.verify()).removed).toEqual([]);

        await rm(dir, { recursive: true, force: true });
        const after = await cache.verify();
        expect(after.removed).toEqual(['db/postgres@1.2.0']);
        expect((await cache.readMeta()).blueprints).toEqual({});
    });

    it('clear removes the whole cache root', async () => {
        const cache = await cacheIn();
        const tarball = await blueprintTarball();
        await cache.storeBlueprint(
            { id: 'db/postgres', version: '1.2.0', integrity: digest(tarball) },
            tarball
        );
        expect(await cache.size()).toBeGreaterThan(0);

        await cache.clear();
        expect(existsSync(cache.layout.root)).toBe(false);
        expect(await cache.size()).toBe(0);
    });
});
