import { existsSync } from 'node:fs';
import { lstat, readdir, readFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import type { BlueprintSummary, LoadedBlueprint } from '@atarashi/core';
import {
    type BlueprintManifest,
    DIAGNOSTIC_CODES,
    type PresetManifest,
    parseBlueprintManifest,
    parsePresetManifest,
} from '@atarashi/schema';
import { RegistryError } from '../errors.js';

export const MANIFEST_FILE = 'blueprint.json';
export const PRESET_FILE = 'preset.json';

const invalid = (message: string, suggestions: string[] = []) =>
    new RegistryError(DIAGNOSTIC_CODES.SCHEMA_INVALID, message, { suggestions });

/**
 * Reads a file from inside a blueprint directory. Blueprint-relative paths are
 * attacker-controlled, so they get the same treatment as output paths: no
 * escaping the blueprint root, and no following a symlink out of it.
 */
async function readInside(root: string, path: string): Promise<Buffer> {
    if (path.includes('\0')) throw invalid(`Blueprint file path contains a null byte`);
    if (isAbsolute(path)) throw invalid(`Blueprint file \`${path}\` must be relative`);

    const target = resolve(root, path);
    const rel = relative(root, target);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) {
        throw new RegistryError(
            DIAGNOSTIC_CODES.PATH_ESCAPE,
            `Blueprint file \`${path}\` resolves outside its own directory`
        );
    }

    // Walk the chain so a symlink at any depth is caught, not just the leaf.
    let walked = root;
    for (const segment of rel.split(sep)) {
        walked = join(walked, segment);
        const info = await lstat(walked).catch(() => undefined);
        if (info?.isSymbolicLink()) {
            throw new RegistryError(
                DIAGNOSTIC_CODES.PATH_ESCAPE,
                `Blueprint file \`${path}\` passes through the symlink \`${segment}\``
            );
        }
    }

    return readFile(target);
}

export interface DirectoryBlueprintOptions {
    trusted: boolean;
    /** Human-readable provenance for diagnostics. Defaults to the directory. */
    origin?: string;
}

/** Loads one blueprint from a directory containing a `blueprint.json`. */
export async function loadBlueprintDir(
    dir: string,
    options: DirectoryBlueprintOptions
): Promise<LoadedBlueprint> {
    const manifestPath = join(dir, MANIFEST_FILE);
    if (!existsSync(manifestPath)) {
        throw invalid(`No \`${MANIFEST_FILE}\` in ${dir}`, [
            'Run `atarashi create-blueprint --validate .` inside the blueprint',
        ]);
    }

    const raw = await readFile(manifestPath, 'utf8');
    let parsedJson: unknown;
    try {
        parsedJson = JSON.parse(raw) as unknown;
    } catch (cause) {
        throw new RegistryError(
            DIAGNOSTIC_CODES.SCHEMA_INVALID,
            `${manifestPath} is not valid JSON`,
            { cause }
        );
    }

    const parsed = parseBlueprintManifest(parsedJson, manifestPath);
    if (!parsed.ok) {
        throw new RegistryError(parsed.error.code, parsed.error.message, {
            detail: parsed.error.diagnostics.map((d) => d.message).join('\n'),
        });
    }

    return {
        manifest: parsed.value,
        origin: options.origin ?? dir,
        dir,
        trusted: options.trusted,
        readFile: (path: string) => readInside(dir, path),
    };
}

export async function loadPresetFile(path: string): Promise<PresetManifest> {
    const parsed = parsePresetManifest(JSON.parse(await readFile(path, 'utf8')) as unknown, path);
    if (!parsed.ok) {
        throw new RegistryError(parsed.error.code, parsed.error.message, {
            detail: parsed.error.diagnostics.map((d) => d.message).join('\n'),
        });
    }
    return parsed.value;
}

export const summarize = (manifest: BlueprintManifest): BlueprintSummary => ({
    id: manifest.id,
    version: manifest.version,
    provides: manifest.provides,
    requires: manifest.requires,
    conflicts: manifest.conflicts,
    deprecated: Boolean(manifest.deprecated),
});

/**
 * A tree of blueprints laid out as `<root>/<namespace>/<name>/blueprint.json`,
 * with presets in `<root>/../presets/*.json`. Backs both the bundled collection
 * and a project's own `./.atarashi/blueprints`.
 */
export class DirectorySource {
    private manifests: Map<string, string> | undefined;

    constructor(
        readonly root: string,
        private readonly options: DirectoryBlueprintOptions & { presetsDir?: string }
    ) {}

    /** Scans lazily and once — a cold `atarashi list` should not pay twice. */
    private async scan(): Promise<Map<string, string>> {
        if (this.manifests) return this.manifests;
        const found = new Map<string, string>();

        if (existsSync(this.root)) {
            for (const namespace of await readdir(this.root, { withFileTypes: true })) {
                if (!namespace.isDirectory()) continue;
                const namespaceDir = join(this.root, namespace.name);
                for (const name of await readdir(namespaceDir, { withFileTypes: true })) {
                    if (!name.isDirectory()) continue;
                    const dir = join(namespaceDir, name.name);
                    if (existsSync(join(dir, MANIFEST_FILE))) {
                        found.set(`${namespace.name}/${name.name}`, dir);
                    }
                }
            }
        }

        this.manifests = found;
        return found;
    }

    async ids(): Promise<string[]> {
        return [...(await this.scan()).keys()].sort();
    }

    async has(id: string): Promise<boolean> {
        return (await this.scan()).has(id);
    }

    async load(id: string): Promise<LoadedBlueprint | undefined> {
        const dir = (await this.scan()).get(id);
        if (!dir) return undefined;
        return loadBlueprintDir(dir, this.options);
    }

    async summaries(): Promise<BlueprintSummary[]> {
        const out: BlueprintSummary[] = [];
        for (const id of await this.ids()) {
            const blueprint = await this.load(id);
            if (blueprint) out.push(summarize(blueprint.manifest));
        }
        return out;
    }

    async loadPreset(id: string): Promise<PresetManifest | undefined> {
        const dir = this.options.presetsDir;
        if (!dir) return undefined;
        const file = join(dir, `${id.replace(/^preset\//, '')}.json`);
        if (!existsSync(file)) return undefined;
        return loadPresetFile(file);
    }

    async presets(): Promise<PresetManifest[]> {
        const dir = this.options.presetsDir;
        if (!dir || !existsSync(dir)) return [];
        const files = (await readdir(dir)).filter((file) => file.endsWith('.json')).sort();
        return Promise.all(files.map((file) => loadPresetFile(join(dir, file))));
    }
}
