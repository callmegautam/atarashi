import {
    DIAGNOSTIC_CODES,
    type Diagnostic,
    parseRegistryIndex,
    type RegistryIndex,
    warning,
} from '@atarashi/schema';
import { rcompare, valid } from 'semver';
import type { RegistryCache } from './cache.js';
import { RegistryError, unavailable } from './errors.js';
import { type FetchLike, httpGet, joinUrl } from './http.js';
import { verifyIndexIntegrity } from './integrity.js';
import { DEFAULT_REGISTRY_URL, DEFAULT_TTL_MS } from './paths.js';

export interface IndexStoreOptions {
    cache: RegistryCache;
    url?: string;
    /** Exact registry version to resolve against. Immutable once published. */
    pin?: string | null;
    offline?: boolean;
    ttlMs?: number;
    fetchImpl?: FetchLike;
    now?: () => Date;
    /** Third-party sources never get to run hooks, whatever their index says. */
    trusted?: boolean;
}

/** Where a resolved index came from — reported by `atarashi doctor`. */
export interface IndexOrigin {
    version: string;
    url: string;
    from: 'network' | 'cache' | 'bundled';
    fetchedAt?: string;
    integrity?: string;
}

const indexUrl = (base: string, pin?: string | null): string =>
    pin ? joinUrl(base, `v1/${pin}/index.json`) : joinUrl(base, 'v1/index.json');

/**
 * Fetches, verifies and caches the registry index.
 *
 * Freshness is a 24 h TTL plus an ETag: inside the TTL nothing is requested at
 * all, and after it a `304` costs one conditional GET. A pinned version skips
 * both — it is immutable, so a cache hit is always correct.
 */
export class IndexStore {
    private readonly options: Required<Pick<IndexStoreOptions, 'url' | 'ttlMs'>> &
        IndexStoreOptions;
    private loaded: { index: RegistryIndex; origin: IndexOrigin } | undefined;
    readonly diagnostics: Diagnostic[] = [];

    constructor(options: IndexStoreOptions) {
        this.options = {
            url: DEFAULT_REGISTRY_URL,
            ttlMs: DEFAULT_TTL_MS,
            ...options,
        };
    }

    get url(): string {
        return this.options.url;
    }

    get origin(): IndexOrigin | undefined {
        return this.loaded?.origin;
    }

    /** Resolves once per process; subsequent calls reuse the verified document. */
    async load(): Promise<{ index: RegistryIndex; origin: IndexOrigin }> {
        if (this.loaded) return this.loaded;
        this.loaded = this.options.pin
            ? await this.loadPinned(this.options.pin)
            : await this.loadLatest();
        return this.loaded;
    }

    /** Discards the TTL and re-checks the network — `atarashi registry update`. */
    async refresh(): Promise<{ index: RegistryIndex; origin: IndexOrigin }> {
        this.loaded = undefined;
        const cache = this.options.cache;
        await cache.writeMeta((meta) => {
            delete meta.index[indexUrl(this.options.url, this.options.pin)];
        });
        return this.load();
    }

    private async loadPinned(version: string) {
        const cache = this.options.cache;
        if (!valid(version)) {
            throw unavailable(`\`${version}\` is not a valid registry version`, [
                'Registry versions are exact semver, e.g. `atarashi registry pin 1.4.2`',
            ]);
        }

        const cached = await cache.readIndex(version, this.options.url);
        if (cached) {
            return { index: cached, origin: this.originOf(cached, 'cache') };
        }
        if (this.options.offline) {
            throw unavailable(`Registry ${version} is pinned but not cached, and you are offline`, [
                'Run `atarashi registry update` with a network connection',
                'Or remove the pin with `atarashi registry unpin`',
            ]);
        }

        const url = indexUrl(this.options.url, version);
        const response = await httpGet(url, { fetchImpl: this.options.fetchImpl });
        const index = this.parse(response.body, url);
        if (index.version !== version) {
            throw unavailable(
                `Registry ${version} was requested but ${url} served ${index.version}`
            );
        }
        await this.persist(index, url, response.etag);
        return { index, origin: this.originOf(index, 'network') };
    }

    private async loadLatest() {
        const cache = this.options.cache;
        const url = indexUrl(this.options.url);
        const meta = await cache.readMeta();
        const record = meta.index[url];

        const cachedIndex = record ? await cache.readIndex(record.version, url) : undefined;

        if (this.options.offline) {
            const offlineIndex = cachedIndex ?? (await this.newestCached());
            if (offlineIndex)
                return { index: offlineIndex, origin: this.originOf(offlineIndex, 'cache') };
            throw unavailable('No cached registry index, and the network is disabled', [
                'Run `atarashi registry update` with a network connection',
                'Bundled blueprints still work offline — drop `--offline` only if you need registry-only ones',
            ]);
        }

        if (cachedIndex && record && this.isFresh(record.fetchedAt)) {
            return {
                index: cachedIndex,
                origin: this.originOf(cachedIndex, 'cache', record.fetchedAt),
            };
        }

        try {
            const response = await httpGet(url, {
                etag: record?.etag,
                fetchImpl: this.options.fetchImpl,
            });

            if (response.status === 304 && cachedIndex) {
                await this.touch(url, cachedIndex.version, record?.etag);
                return { index: cachedIndex, origin: this.originOf(cachedIndex, 'cache') };
            }

            const index = this.parse(response.body, url);
            await this.persist(index, url, response.etag);
            return { index, origin: this.originOf(index, 'network') };
        } catch (thrown) {
            // Integrity failures are never survivable; unreachability is.
            if (
                thrown instanceof RegistryError &&
                thrown.code !== DIAGNOSTIC_CODES.REGISTRY_UNAVAILABLE
            ) {
                throw thrown;
            }
            const fallback = cachedIndex ?? (await this.newestCached());
            if (!fallback) throw thrown;

            this.diagnostics.push(
                warning(
                    DIAGNOSTIC_CODES.REGISTRY_UNAVAILABLE,
                    `Registry unreachable; using the cached index ${fallback.version}`,
                    {
                        detail: thrown instanceof Error ? thrown.message : String(thrown),
                        suggestions: ['Run `atarashi registry update` once you are back online'],
                    }
                )
            );
            return { index: fallback, origin: this.originOf(fallback, 'cache') };
        }
    }

    private parse(body: Buffer, url: string): RegistryIndex {
        let raw: unknown;
        try {
            raw = JSON.parse(body.toString('utf8')) as unknown;
        } catch (cause) {
            throw new RegistryError(
                DIAGNOSTIC_CODES.REGISTRY_UNAVAILABLE,
                `${url} did not return valid JSON`,
                { cause }
            );
        }

        const parsed = parseRegistryIndex(raw, url);
        if (!parsed.ok) {
            throw new RegistryError(parsed.error.code, `${parsed.error.message} (${url})`, {
                suggestions: ['Upgrade Atarashi — this index may use a newer index version'],
            });
        }

        verifyIndexIntegrity(parsed.value, url);
        return parsed.value;
    }

    private async persist(index: RegistryIndex, url: string, etag: string | undefined) {
        await this.options.cache.writeIndex(index);
        await this.touch(url, index.version, etag);
    }

    private async touch(url: string, version: string, etag: string | undefined) {
        const fetchedAt = this.nowIso();
        await this.options.cache.writeMeta((meta) => {
            meta.index[url] = etag ? { etag, fetchedAt, version } : { fetchedAt, version };
        });
    }

    private async newestCached(): Promise<RegistryIndex | undefined> {
        const versions = (await this.options.cache.cachedIndexVersions())
            .filter((version) => valid(version))
            .sort(rcompare);
        for (const version of versions) {
            const index = await this.options.cache.readIndex(version, this.options.url);
            if (index) return index;
        }
        return undefined;
    }

    private isFresh(fetchedAt: string): boolean {
        const age = this.now() - Date.parse(fetchedAt);
        return Number.isFinite(age) && age >= 0 && age < this.options.ttlMs;
    }

    private originOf(
        index: RegistryIndex,
        from: IndexOrigin['from'],
        fetchedAt?: string
    ): IndexOrigin {
        const origin: IndexOrigin = { version: index.version, url: this.options.url, from };
        if (fetchedAt) origin.fetchedAt = fetchedAt;
        if (index.integrity) origin.integrity = index.integrity;
        return origin;
    }

    private now(): number {
        return (this.options.now?.() ?? new Date()).getTime();
    }

    private nowIso(): string {
        return new Date(this.now()).toISOString();
    }
}
