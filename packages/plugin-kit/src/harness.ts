import { join } from 'node:path';
import type { BlueprintSource, BlueprintSummary, LoadedBlueprint } from '@atarashi/core';
import { generate } from '@atarashi/core';
import { DirectorySource, readBundledVersionManifest } from '@atarashi/registry';
import type {
    GenerationPlan,
    JsonValue,
    PresetManifest,
    ProjectSpec,
    Result,
} from '@atarashi/schema';

/** The instant every generated plan is stamped with, so output never drifts with the clock. */
export const FIXED_NOW = new Date('2026-01-01T00:00:00.000Z');
export const FIXED_VERSION = '1.0.0';

/**
 * A blueprint collection laid out on disk exactly as `@atarashi/blueprints`
 * ships it: `<root>/blueprints/<namespace>/<name>`, `<root>/presets`, and a
 * `<root>/version-manifest.json`. This is the same `DirectorySource` the CLI
 * uses for the bundled catalogue, so a blueprint that passes here is loadable
 * in production.
 */
export class Catalogue implements BlueprintSource {
    private readonly directory: DirectorySource;
    private readonly versionManifestPath: string;
    private versions: Record<string, string> | undefined;

    constructor(readonly root: string) {
        this.directory = new DirectorySource(join(root, 'blueprints'), {
            trusted: true,
            origin: 'bundled',
            presetsDir: join(root, 'presets'),
        });
        this.versionManifestPath = join(root, 'version-manifest.json');
    }

    ids(): Promise<string[]> {
        return this.directory.ids();
    }

    load(id: string): Promise<LoadedBlueprint | undefined> {
        return this.directory.load(id);
    }

    async providersOf(capability: string): Promise<BlueprintSummary[]> {
        const summaries = await this.directory.summaries();
        return summaries.filter((summary) => summary.provides.includes(capability));
    }

    loadPreset(id: string): Promise<PresetManifest | undefined> {
        return this.directory.loadPreset(id);
    }

    presets(): Promise<PresetManifest[]> {
        return this.directory.presets();
    }

    async versionManifest(): Promise<Record<string, string>> {
        this.versions ??= (await readBundledVersionManifest(this.versionManifestPath)) ?? {};
        return this.versions;
    }
}

export interface SpecOptions {
    name?: string;
    description?: string;
    answers?: Record<string, JsonValue>;
    packageManager?: 'pnpm' | 'npm' | 'yarn' | 'bun';
    license?: string | null;
    author?: { name?: string; email?: string; url?: string } | null;
    writeEnv?: boolean;
    install?: boolean;
    preset?: string;
    reason?: 'user' | 'preset';
}

/** A fully-defaulted `ProjectSpec`, so tests only state what they care about. */
export function makeSpec(ids: string[], options: SpecOptions = {}): ProjectSpec {
    return {
        specVersion: 1,
        name: options.name ?? 'my-app',
        ...(options.description ? { description: options.description } : {}),
        ...(options.preset ? { preset: options.preset } : {}),
        blueprints: ids.map((id) => ({ id, reason: options.reason ?? 'user' })),
        answers: options.answers ?? {},
        options: {
            packageManager: options.packageManager ?? 'pnpm',
            git: true,
            install: options.install ?? true,
            format: true,
            initialCommit: true,
            license: options.license === undefined ? 'MIT' : options.license,
            author: options.author ?? null,
            writeEnv: options.writeEnv ?? false,
            force: false,
        },
    };
}

/** Expands a preset into a spec, exactly as the CLI's `--preset` will. */
export async function specForPreset(
    catalogue: Catalogue,
    presetId: string,
    options: SpecOptions = {}
): Promise<ProjectSpec> {
    const preset = await catalogue.loadPreset(presetId);
    if (!preset) throw new Error(`Unknown preset \`${presetId}\``);

    return makeSpec(preset.blueprints, {
        ...options,
        reason: 'preset',
        preset: preset.id,
        answers: { ...preset.answers, ...(options.answers ?? {}) },
    });
}

export function planFor(catalogue: Catalogue, spec: ProjectSpec): Promise<Result<GenerationPlan>> {
    return generate(spec, {
        source: catalogue,
        atarashiVersion: FIXED_VERSION,
        nodeVersion: '22.0.0',
        now: () => FIXED_NOW,
    });
}

/** Throws with the diagnostics attached, so a failing test says why. */
export async function expectPlan(catalogue: Catalogue, spec: ProjectSpec): Promise<GenerationPlan> {
    const result = await planFor(catalogue, spec);
    if (!result.ok) {
        const detail = result.error.diagnostics
            .map((diagnostic) => `  [${diagnostic.severity}] ${diagnostic.message}`)
            .join('\n');
        throw new Error(`${result.error.message}\n${detail}`);
    }
    return result.value;
}

/** The generated file at `path`, as text. Throws if the plan does not have it. */
export function fileAt(plan: GenerationPlan, path: string): string {
    const file = plan.files.find((candidate) => candidate.path === path);
    if (!file) {
        throw new Error(
            `No \`${path}\` in the plan. It has:\n${plan.files.map((f) => `  ${f.path}`).join('\n')}`
        );
    }
    return typeof file.contents === 'string' ? file.contents : file.contents.toString('utf8');
}

export const hasFile = (plan: GenerationPlan, path: string): boolean =>
    plan.files.some((file) => file.path === path);

/** The resolved range for a package, from either dependency group. */
export function dependencyRange(plan: GenerationPlan, name: string): string | undefined {
    const entry = [...plan.summary.deps.dependencies, ...plan.summary.deps.devDependencies].find(
        (candidate) => candidate.name === name
    );
    return entry?.range;
}
