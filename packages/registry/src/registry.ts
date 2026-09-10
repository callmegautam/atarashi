import type { BlueprintSource, BlueprintSummary, LoadedBlueprint } from '@atarashi/core';
import {
    DIAGNOSTIC_CODES,
    type Diagnostic,
    type PresetManifest,
    type RegistryPin,
    type RegistrySource,
} from '@atarashi/schema';
import { gt, valid } from 'semver';
import { RegistryCache } from './cache.js';
import { RegistryError } from './errors.js';
import type { FetchLike } from './http.js';
import { IndexStore } from './index-store.js';
import {
    type BundledSource,
    createBundledSource,
    readBundledVersionManifest,
} from './loaders/bundled.js';
import type { DirectorySource } from './loaders/directory.js';
import { createLocalSource } from './loaders/local.js';
import { NPM_PREFIX, NpmSource } from './loaders/npm.js';
import { RemoteSource } from './loaders/remote.js';
import { DEFAULT_REGISTRY_URL, DEFAULT_TTL_MS, resolveCacheRoot } from './paths.js';

export interface RegistryOptions {
    /** The project directory — where local and npm blueprints are looked up. */
    cwd?: string;
    cacheDir?: string;
    url?: string;
    /** Exact registry version, from `atarashi.json` or `atarashi registry pin`. */
    pin?: string | null;
    offline?: boolean;
    ttlMs?: number;
    /** Extra third-party sources. Untrusted unless the user marked them trusted. */
    sources?: RegistrySource[];
    /** Community packages pulled in with `--add npm:atarashi-blueprint-x`. */
    npmPackages?: string[];
    bundledDir?: string;
    localDir?: string;
    fetchImpl?: FetchLike;
    now?: () => Date;
    env?: NodeJS.ProcessEnv;
}

/** Where a blueprint id was resolved from, for `atarashi info` and diagnostics. */
export type SourceKind = 'local' | 'npm' | 'registry' | 'bundled';

interface RemoteLayer {
    name: string;
    store: IndexStore;
    source: RemoteSource;
}

const isOffline = (options: RegistryOptions): boolean => {
    if (options.offline !== undefined) return options.offline;
    const env = options.env ?? process.env;
    return env.ATARASHI_OFFLINE === '1' || env.ATARASHI_OFFLINE === 'true';
};

/**
 * The one I/O boundary for blueprints. Core asks this for a `LoadedBlueprint`
 * and never touches disk or the network itself.
 *
 * Four layers, in precedence order:
 *
 * 1. `./.atarashi/blueprints` — a project's own, so an author can override
 *    anything while developing.
 * 2. `npm:` packages the user explicitly asked for.
 * 3. the remote registry and the bundled collection, whichever has the newer
 *    version — this is what lets a registry release ship a blueprint fix
 *    without a CLI release, while a plane-mode run still works.
 */
export class Registry implements BlueprintSource {
    private readonly local: DirectorySource;
    private readonly npm: NpmSource;
    private readonly bundled: BundledSource | undefined;
    private readonly remotes: RemoteLayer[] = [];
    private readonly primary: RemoteLayer | undefined;
    readonly cache: RegistryCache;
    readonly offline: boolean;

    constructor(options: RegistryOptions = {}) {
        const cwd = options.cwd ?? process.cwd();
        this.offline = isOffline(options);
        this.cache = new RegistryCache(
            options.cacheDir ?? resolveCacheRoot(options.env ?? process.env)
        );

        this.local = createLocalSource(cwd, options.localDir);
        this.npm = new NpmSource(cwd, [...(options.npmPackages ?? [])]);
        this.bundled = createBundledSource(options.bundledDir);

        const configured: RegistrySource[] = options.sources?.length
            ? options.sources
            : [
                  {
                      name: 'atarashi',
                      url: options.url ?? DEFAULT_REGISTRY_URL,
                      trusted: true,
                      enabled: true,
                  },
              ];

        for (const source of configured.filter((candidate) => candidate.enabled !== false)) {
            const store = new IndexStore({
                cache: this.cache,
                url: source.url,
                pin: options.pin ?? null,
                offline: this.offline,
                ttlMs: options.ttlMs ?? DEFAULT_TTL_MS,
                fetchImpl: options.fetchImpl,
                now: options.now,
            });
            this.remotes.push({
                name: source.name,
                store,
                source: new RemoteSource(store, this.cache, {
                    offline: this.offline,
                    fetchImpl: options.fetchImpl,
                    trusted: source.trusted === true,
                }),
            });
        }
        this.primary = this.remotes[0];
    }

    /** Warnings collected while resolving — degraded-network notices, mostly. */
    get diagnostics(): Diagnostic[] {
        return this.remotes.flatMap((layer) => layer.store.diagnostics);
    }

    // ── BlueprintSource ──────────────────────────────────────────────────────

    async load(id: string): Promise<LoadedBlueprint | undefined> {
        if (id.startsWith(NPM_PREFIX)) return this.npm.load(id);

        const local = await this.local.load(id);
        if (local) return local;

        const fromNpm = await this.npm.load(id);
        if (fromNpm) return fromNpm;

        const bundled = await this.bundled?.source.load(id);

        for (const layer of this.remotes) {
            const entry = await layer.source.entry(id);
            if (!entry) continue;
            // The bundled copy wins ties, so an unchanged blueprint never costs
            // a download.
            if (bundled && !isNewer(entry.version, bundled.manifest.version)) break;
            try {
                return await layer.source.loadEntry(entry);
            } catch (thrown) {
                if (
                    thrown instanceof RegistryError &&
                    thrown.code === DIAGNOSTIC_CODES.INTEGRITY_MISMATCH
                ) {
                    throw thrown;
                }
                if (!bundled) throw thrown;
                break; // fall back to the bundled copy
            }
        }

        return bundled;
    }

    async providersOf(capability: string): Promise<BlueprintSummary[]> {
        const all = await this.summaries();
        return all
            .filter((summary) => summary.provides.includes(capability))
            .sort((a, b) => (a.id < b.id ? -1 : 1));
    }

    async loadPreset(id: string): Promise<PresetManifest | undefined> {
        const local = await this.local.loadPreset(id);
        if (local) return local;
        for (const layer of this.remotes) {
            const preset = await layer.source.loadPreset(id);
            if (preset) return preset;
        }
        return this.bundled?.source.loadPreset(id);
    }

    /** Every preset visible from every layer, deduplicated by precedence — `atarashi list presets`. */
    async presets(): Promise<PresetManifest[]> {
        const merged = new Map<string, PresetManifest>();

        for (const preset of (await this.bundled?.source.presets()) ?? [])
            merged.set(preset.id, preset);

        for (const layer of this.remotes) {
            const loaded = await layer.store.load().catch(() => undefined);
            const presetEntries =
                loaded?.index.entries.filter((entry) => entry.kind === 'preset') ?? [];
            for (const entry of presetEntries) {
                const preset = await layer.source.loadPreset(entry.id);
                if (preset) merged.set(preset.id, preset);
            }
        }

        // Local is an absolute override, not a version comparison.
        for (const preset of await this.local.presets()) merged.set(preset.id, preset);

        return [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    }

    /**
     * One place defines the range every blueprint uses. The registry's manifest
     * wins over the bundled one; anything the registry does not pin keeps the
     * bundled value, so an offline run resolves the same names.
     */
    async versionManifest(): Promise<Record<string, string>> {
        const bundled = this.bundled
            ? ((await readBundledVersionManifest(this.bundled.versionManifestPath)) ?? {})
            : {};
        const remote = (await this.primary?.source.versionManifest()) ?? {};
        return { ...bundled, ...remote };
    }

    // ── Beyond the core interface ────────────────────────────────────────────

    /** Every blueprint visible from every layer, deduplicated by precedence. */
    async summaries(): Promise<BlueprintSummary[]> {
        const merged = new Map<string, BlueprintSummary>();

        const put = (summary: BlueprintSummary, overwrite: boolean) => {
            const existing = merged.get(summary.id);
            if (!existing || (overwrite && isNewer(summary.version, existing.version))) {
                merged.set(summary.id, summary);
            }
        };

        for (const summary of (await this.bundled?.source.summaries()) ?? []) put(summary, false);
        for (const layer of this.remotes) {
            for (const summary of await layer.source.summaries()) put(summary, true);
        }
        // Local and npm are absolute overrides, not version comparisons.
        for (const summary of await this.npm.summaries()) merged.set(summary.id, summary);
        for (const summary of await this.local.summaries()) merged.set(summary.id, summary);

        return [...merged.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
    }

    async list(): Promise<BlueprintSummary[]> {
        return this.summaries();
    }

    /** Which layer an id resolves from, without loading its files. */
    async originOf(id: string): Promise<SourceKind | undefined> {
        if (await this.local.has(id)) return 'local';
        if (await this.npm.load(id).catch(() => undefined)) return 'npm';
        for (const layer of this.remotes) {
            if (await layer.source.entry(id)) return 'registry';
        }
        return (await this.bundled?.source.load(id)) ? 'bundled' : undefined;
    }

    /** What gets written into `atarashi.json` so this run can be reproduced. */
    async pin(): Promise<RegistryPin | undefined> {
        if (!this.primary) return undefined;
        try {
            const { index, origin } = await this.primary.store.load();
            const record: RegistryPin = { version: index.version };
            if (index.integrity) record.integrity = index.integrity;
            if (origin.url !== DEFAULT_REGISTRY_URL) record.source = origin.url;
            return record;
        } catch {
            // A run that never reached the registry pins nothing, rather than
            // pinning a version it did not actually use.
            return undefined;
        }
    }

    /** `atarashi registry update` — ignore the TTL and re-check every source. */
    async update(): Promise<{ name: string; version: string; from: string }[]> {
        const results: { name: string; version: string; from: string }[] = [];
        for (const layer of this.remotes) {
            const { index, origin } = await layer.store.refresh();
            results.push({ name: layer.name, version: index.version, from: origin.from });
        }
        return results;
    }

    /** `atarashi registry list` — every version this machine has verified. */
    async cachedVersions(): Promise<string[]> {
        return this.cache.cachedIndexVersions();
    }

    verifyCache() {
        return this.cache.verify();
    }

    clearCache() {
        return this.cache.clear();
    }

    addNpmPackage(spec: string): this {
        this.npm.add(spec);
        return this;
    }
}

const isNewer = (candidate: string, incumbent: string): boolean =>
    valid(candidate) && valid(incumbent) ? gt(candidate, incumbent) : false;

export const createRegistry = (options: RegistryOptions = {}): Registry => new Registry(options);
