import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { RegistryCache } from '../src/cache.js';
import { assertFetchable, httpGet } from '../src/http.js';
import { IndexStore } from '../src/index-store.js';
import { makeIndex, stubFetch, tempDir } from './helpers.js';

const URL_ = 'https://registry.example.dev';

async function setup(options: Parameters<typeof makeIndex>[0] = [], indexOptions = {}) {
    const cache = new RegistryCache(join(await tempDir(), 'cache'));
    const fixture = makeIndex(options, indexOptions);
    return { cache, fixture };
}

describe('transport', () => {
    it('refuses plaintext HTTP and unknown protocols', () => {
        expect(() => assertFetchable('https://atarashi.gautamsuthar.in/registry')).not.toThrow();
        expect(() => assertFetchable('http://atarashi.gautamsuthar.in/registry')).toThrow(
            /plain HTTP/
        );
        expect(() => assertFetchable('ftp://atarashi.gautamsuthar.in/registry')).toThrow(
            /Unsupported/
        );
        expect(() => assertFetchable('not a url')).toThrow(/not a valid/);
    });

    it('reads file: URLs, so a local mirror can stand in for the CDN', async () => {
        const path = join(await tempDir(), 'index.json');
        await writeFile(path, '{"ok":true}');
        const response = await httpGet(new URL(`file://${path}`).href);
        expect(response.body.toString()).toBe('{"ok":true}');
    });

    it('reports an unreachable registry with the URL and a next step', async () => {
        await expect(
            httpGet(`${URL_}/v1/index.json`, {
                fetchImpl: async () => {
                    throw new Error('ENOTFOUND');
                },
            })
        ).rejects.toThrow(/Cannot reach https:\/\/registry\.example\.dev/);
    });
});

describe('fetching the latest index', () => {
    it('fetches, verifies and caches on a cold start', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }]);
        const { impl, calls } = stubFetch(fixture, { etag: 'W/"1"' });
        const store = new IndexStore({ cache, url: URL_, fetchImpl: impl });

        const { index, origin } = await store.load();
        expect(index.version).toBe('1.0.0');
        expect(origin.from).toBe('network');
        expect(calls[0]!.url).toBe(`${URL_}/v1/index.json`);
        expect(await cache.readIndex('1.0.0', URL_)).toEqual(index);
    });

    it('skips the network entirely inside the TTL', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }]);
        const { impl, calls } = stubFetch(fixture);

        const first = new IndexStore({ cache, url: URL_, fetchImpl: impl });
        await first.load();
        const second = new IndexStore({ cache, url: URL_, fetchImpl: impl });
        const { origin } = await second.load();

        expect(calls).toHaveLength(1);
        expect(origin.from).toBe('cache');
    });

    it('sends the stored ETag once the TTL has expired and accepts a 304', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }]);
        const { impl, calls } = stubFetch(fixture, { etag: 'W/"abc"' });

        await new IndexStore({ cache, url: URL_, fetchImpl: impl }).load();

        const stale = new IndexStore({ cache, url: URL_, fetchImpl: impl, ttlMs: 0 });
        const { index, origin } = await stale.load();

        expect(calls).toHaveLength(2);
        expect(calls[1]!.headers['if-none-match']).toBe('W/"abc"');
        expect(origin.from).toBe('cache');
        expect(index.version).toBe('1.0.0');
    });

    it('re-checks the network on refresh even inside the TTL', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }]);
        const { impl, calls } = stubFetch(fixture);
        const store = new IndexStore({ cache, url: URL_, fetchImpl: impl });

        await store.load();
        await store.refresh();
        expect(calls).toHaveLength(2);
    });

    it('falls back to the cache with a warning when the registry is unreachable', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }]);
        await new IndexStore({ cache, url: URL_, fetchImpl: stubFetch(fixture).impl }).load();

        const offlineish = stubFetch(fixture, { failWith: new Error('ENETDOWN') });
        const store = new IndexStore({
            cache,
            url: URL_,
            fetchImpl: offlineish.impl,
            ttlMs: 0,
        });

        const { index, origin } = await store.load();
        expect(index.version).toBe('1.0.0');
        expect(origin.from).toBe('cache');
        expect(store.diagnostics[0]).toMatchObject({
            severity: 'warning',
            code: 'ATA_REGISTRY_UNAVAILABLE',
        });
    });

    it('fails rather than falling back when there is nothing cached', async () => {
        const { cache, fixture } = await setup();
        const store = new IndexStore({
            cache,
            url: URL_,
            fetchImpl: stubFetch(fixture, { failWith: new Error('ENETDOWN') }).impl,
        });
        await expect(store.load()).rejects.toThrow(/Cannot reach/);
    });

    it('never accepts an index whose root hash does not match, even from a live server', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }]);
        fixture.index.entries[0]!.integrity = 'sha256-AAAA';

        const store = new IndexStore({ cache, url: URL_, fetchImpl: stubFetch(fixture).impl });
        await expect(store.load()).rejects.toThrow(/root hash/);
    });

    it('rejects an index that is not a valid registry document', async () => {
        const { cache } = await setup();
        const store = new IndexStore({
            cache,
            url: URL_,
            fetchImpl: async () => new Response(JSON.stringify({ nope: true })),
        });
        await expect(store.load()).rejects.toThrow(/registry index/);
    });
});

describe('offline', () => {
    it('uses the cache and never touches the network', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }]);
        await new IndexStore({ cache, url: URL_, fetchImpl: stubFetch(fixture).impl }).load();

        const calls: string[] = [];
        const store = new IndexStore({
            cache,
            url: URL_,
            offline: true,
            ttlMs: 0,
            fetchImpl: async (url) => {
                calls.push(url);
                throw new Error('should not be called');
            },
        });

        expect((await store.load()).index.version).toBe('1.0.0');
        expect(calls).toEqual([]);
    });

    it('explains what to do when nothing is cached', async () => {
        const { cache } = await setup();
        const store = new IndexStore({ cache, url: URL_, offline: true });
        await expect(store.load()).rejects.toThrow(/No cached registry index/);
    });
});

describe('pinning', () => {
    it('fetches the pinned version from its immutable URL', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }], {
            version: '1.4.2',
        });
        const { impl, calls } = stubFetch(fixture);

        const store = new IndexStore({ cache, url: URL_, pin: '1.4.2', fetchImpl: impl });
        expect((await store.load()).index.version).toBe('1.4.2');
        expect(calls[0]!.url).toBe(`${URL_}/v1/1.4.2/index.json`);
    });

    it('serves a pinned version straight from cache, with no request at all', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }], {
            version: '1.4.2',
        });
        const { impl, calls } = stubFetch(fixture);
        await new IndexStore({ cache, url: URL_, pin: '1.4.2', fetchImpl: impl }).load();

        const again = new IndexStore({ cache, url: URL_, pin: '1.4.2', fetchImpl: impl });
        expect((await again.load()).origin.from).toBe('cache');
        expect(calls).toHaveLength(1);
    });

    it('refuses a server that serves a different version than the one pinned', async () => {
        const { cache, fixture } = await setup([{ id: 'db/postgres', tarball: Buffer.from('t') }], {
            version: '1.0.0',
        });
        const store = new IndexStore({
            cache,
            url: URL_,
            pin: '1.4.2',
            fetchImpl: stubFetch(fixture).impl,
        });
        await expect(store.load()).rejects.toThrow(/served 1\.0\.0/);
    });

    it('rejects a pin that is not exact semver', async () => {
        const { cache } = await setup();
        const store = new IndexStore({ cache, url: URL_, pin: '^1.4' });
        await expect(store.load()).rejects.toThrow(/not a valid registry version/);
    });

    it('says so when a pinned version is missing offline', async () => {
        const { cache } = await setup();
        const store = new IndexStore({ cache, url: URL_, pin: '1.4.2', offline: true });
        await expect(store.load()).rejects.toThrow(/pinned but not cached/);
    });
});
