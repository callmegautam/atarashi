import { join } from 'node:path';
import type { BlueprintSummary, LoadedBlueprint } from '@atarashi/core';
import { DIAGNOSTIC_CODES, type RegistryEntry, type RegistryIndex } from '@atarashi/schema';
import type { RegistryCache } from '../cache.js';
import { RegistryError, unavailable } from '../errors.js';
import { type FetchLike, httpGet, joinUrl } from '../http.js';
import type { IndexStore } from '../index-store.js';
import { loadBlueprintDir, loadPresetFile } from './directory.js';

export const entrySummary = (entry: RegistryEntry): BlueprintSummary => ({
    id: entry.id,
    version: entry.version,
    provides: entry.provides,
    requires: entry.requires,
    conflicts: entry.conflicts,
    deprecated: entry.deprecated,
});

/**
 * Blueprints from the remote index. Resolution is index-only — capabilities,
 * versions and conflicts all come from entry summaries — so nothing is
 * downloaded until a blueprint is actually part of the graph.
 */
export class RemoteSource {
    constructor(
        private readonly store: IndexStore,
        private readonly cache: RegistryCache,
        private readonly options: {
            offline?: boolean;
            fetchImpl?: FetchLike;
            /** Set from the *source* config, never from the index it serves. */
            trusted?: boolean;
        } = {}
    ) {}

    /** `undefined` when the index cannot be reached at all — bundled still works. */
    private async index(): Promise<RegistryIndex | undefined> {
        try {
            return (await this.store.load()).index;
        } catch (thrown) {
            if (
                thrown instanceof RegistryError &&
                thrown.code === DIAGNOSTIC_CODES.INTEGRITY_MISMATCH
            ) {
                throw thrown;
            }
            return undefined;
        }
    }

    async entry(id: string): Promise<RegistryEntry | undefined> {
        const index = await this.index();
        return index?.entries.find(
            (candidate) => candidate.id === id && candidate.kind !== 'preset'
        );
    }

    async summaries(): Promise<BlueprintSummary[]> {
        const index = await this.index();
        return (index?.entries ?? []).filter((entry) => entry.kind !== 'preset').map(entrySummary);
    }

    async versionManifest(): Promise<Record<string, string> | undefined> {
        const index = await this.index();
        return index?.versionManifest?.packages;
    }

    async load(id: string): Promise<LoadedBlueprint | undefined> {
        const entry = await this.entry(id);
        if (!entry) return undefined;
        return this.loadEntry(entry);
    }

    async loadEntry(entry: RegistryEntry): Promise<LoadedBlueprint> {
        const dir = await this.materialize(entry);
        return loadBlueprintDir(dir, {
            // Trust is a property of the source, not of the document it
            // serves: an index cannot promote its own entries.
            trusted: this.options.trusted ?? false,
            origin: `registry:${entry.id}@${entry.version}`,
        });
    }

    async preset(id: string) {
        const index = await this.index();
        return index?.entries.find((entry) => entry.id === id && entry.kind === 'preset');
    }

    async loadPreset(id: string) {
        const entry = await this.preset(id);
        if (!entry) return undefined;
        const dir = await this.materialize(entry);
        return loadPresetFile(join(dir, 'preset.json'));
    }

    /** Downloads and verifies once; every later run is a cache hit. */
    private async materialize(entry: RegistryEntry): Promise<string> {
        if (this.cache.hasBlueprint(entry.id, entry.version, entry.integrity)) {
            return this.cache.blueprintDir(entry.id, entry.version, entry.integrity);
        }
        if (this.options.offline) {
            throw unavailable(
                `${entry.id}@${entry.version} is not cached, and the network is disabled`,
                ['Run the same command without `--offline` once to populate the cache']
            );
        }

        const url = joinUrl(this.store.url, entry.tarball);
        const response = await httpGet(url, { fetchImpl: this.options.fetchImpl });
        return this.cache.storeBlueprint(entry, response.body);
    }
}
