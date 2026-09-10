import { type BlueprintManifest, blueprintManifestSchema } from '@atarashi/schema';
import type { BlueprintSource, BlueprintSummary, LoadedBlueprint } from '../src/types.js';

export interface FakeBlueprintInput extends Partial<BlueprintManifest> {
    id: string;
    /** Blueprint-relative path → contents, standing in for the `files/` tree. */
    fileContents?: Record<string, string>;
    /** What the registry would set for an npm or third-party source. */
    trusted?: boolean;
}

export function makeBlueprint(input: FakeBlueprintInput): LoadedBlueprint {
    const { fileContents = {}, trusted = true, ...rest } = input;
    const manifest = blueprintManifestSchema.parse({
        manifestVersion: 1,
        name: input.id,
        version: '1.0.0',
        description: `Test blueprint ${input.id}`,
        category: 'test',
        ...rest,
    });

    return {
        manifest,
        origin: `memory:${input.id}`,
        trusted,
        async readFile(path: string) {
            const contents = fileContents[path];
            if (contents === undefined) {
                throw new Error(`${input.id} has no file \`${path}\``);
            }
            return Buffer.from(contents, 'utf8');
        },
    };
}

/** An in-memory `BlueprintSource`, so core tests need no registry and no disk. */
export class FakeSource implements BlueprintSource {
    private readonly blueprints = new Map<string, LoadedBlueprint>();
    private readonly versions = new Map<string, string>();

    constructor(inputs: FakeBlueprintInput[] = []) {
        for (const input of inputs) this.add(input);
    }

    add(input: FakeBlueprintInput): this {
        return this.addLoaded(makeBlueprint(input));
    }

    /** For blueprints that must exist on disk — hooks, mostly. */
    addLoaded(blueprint: LoadedBlueprint): this {
        this.blueprints.set(blueprint.manifest.id, blueprint);
        return this;
    }

    pin(name: string, range: string): this {
        this.versions.set(name, range);
        return this;
    }

    async load(id: string) {
        return this.blueprints.get(id);
    }

    async providersOf(capability: string): Promise<BlueprintSummary[]> {
        return [...this.blueprints.values()]
            .filter((entry) => entry.manifest.provides.includes(capability))
            .map((entry) => ({
                id: entry.manifest.id,
                version: entry.manifest.version,
                provides: entry.manifest.provides,
                requires: entry.manifest.requires,
                conflicts: entry.manifest.conflicts,
                deprecated: Boolean(entry.manifest.deprecated),
            }))
            .sort((a, b) => (a.id < b.id ? -1 : 1));
    }

    async versionManifest() {
        return Object.fromEntries(this.versions);
    }
}

export const specFor = (ids: string[], overrides: Record<string, unknown> = {}) => ({
    specVersion: 1 as const,
    name: 'my-api',
    blueprints: ids.map((id) => ({ id, reason: 'user' as const })),
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
    ...overrides,
});
