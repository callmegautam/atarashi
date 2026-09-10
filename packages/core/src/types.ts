import type { BlueprintManifest, PresetManifest } from '@atarashi/schema';
import type { HookRunnerOptions } from './hooks/types.js';

/**
 * A blueprint the registry has already loaded and verified. Core never reads
 * from disk or the network itself — it asks for one of these and renders it.
 */
export interface LoadedBlueprint {
    manifest: BlueprintManifest;
    /** Read a file from inside the blueprint, path relative to its own root. */
    readFile(path: string): Promise<Buffer>;
    /** Where it came from, for diagnostics: a directory, a tarball, an npm package. */
    origin: string;
    /**
     * The blueprint's own directory, when it has one. Hooks can only run from a
     * real directory — the sandbox confines every import to this subtree.
     */
    dir?: string;
    /** Untrusted sources may not run hooks. Set by the registry, never by the manifest. */
    trusted: boolean;
}

/** Enough about a blueprint to resolve capabilities without downloading it. */
export interface BlueprintSummary {
    id: string;
    version: string;
    provides: string[];
    requires: string[];
    conflicts: string[];
    deprecated?: boolean;
}

/**
 * Core's view of the registry. `@atarashi/registry` implements it; tests
 * implement it with an in-memory map.
 */
export interface BlueprintSource {
    load(id: string): Promise<LoadedBlueprint | undefined>;
    /** Every blueprint that provides a capability, for auto-add and ambiguity. */
    providersOf(capability: string): Promise<BlueprintSummary[]>;
    loadPreset?(id: string): Promise<PresetManifest | undefined>;
    /** Pinned dependency ranges shared across blueprints. */
    versionManifest?(): Promise<Record<string, string>>;
}

/** One blueprint in the resolved graph, in execution order. */
export interface GraphNode {
    blueprint: LoadedBlueprint;
    /** Position in the topological order — the tiebreaker for every merge. */
    order: number;
    reason: 'user' | 'preset' | 'auto';
    requiredBy?: string;
}

export interface BlueprintGraph {
    nodes: GraphNode[];
    /** capability token → ids providing it. */
    capabilities: Map<string, string[]>;
    byId: Map<string, GraphNode>;
}

export interface EngineDeps {
    source: BlueprintSource;
    /** The running CLI version, checked against each blueprint's `engines`. */
    atarashiVersion: string;
    nodeVersion?: string;
    /** Injected so snapshots are byte-identical across runs. */
    now?: () => Date;
    /** Hook execution policy: `--no-hooks`, the consent prompt, the timeout. */
    hooks?: HookRunnerOptions;
}
