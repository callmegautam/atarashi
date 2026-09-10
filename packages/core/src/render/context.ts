import type { JsonValue, PackageManager, ProjectSpec } from '@atarashi/schema';
import type { PackageManagerFacts, ProjectFacts, RenderContext } from '../context.js';
import type { BlueprintGraph } from '../types.js';
import { camel, constant, kebab, pascal, slug } from './strings.js';

const PACKAGE_MANAGERS: Record<PackageManager, PackageManagerFacts> = {
    pnpm: {
        name: 'pnpm',
        install: 'pnpm install',
        run: 'pnpm run',
        exec: 'pnpm dlx',
        add: 'pnpm add',
        addDev: 'pnpm add -D',
        lockfile: 'pnpm-lock.yaml',
    },
    npm: {
        name: 'npm',
        install: 'npm install',
        run: 'npm run',
        exec: 'npx',
        add: 'npm install',
        addDev: 'npm install -D',
        lockfile: 'package-lock.json',
    },
    yarn: {
        name: 'yarn',
        install: 'yarn install',
        run: 'yarn',
        exec: 'yarn dlx',
        add: 'yarn add',
        addDev: 'yarn add -D',
        lockfile: 'yarn.lock',
    },
    bun: {
        name: 'bun',
        install: 'bun install',
        run: 'bun run',
        exec: 'bunx',
        add: 'bun add',
        addDev: 'bun add -d',
        lockfile: 'bun.lock',
    },
};

export const packageManagerFacts = (name: PackageManager): PackageManagerFacts =>
    PACKAGE_MANAGERS[name];

export function projectFacts(spec: ProjectSpec, year: number): ProjectFacts {
    return {
        name: spec.name,
        slug: slug(spec.name),
        pascal: pascal(spec.name),
        camel: camel(spec.name),
        kebab: kebab(spec.name),
        constant: constant(spec.name),
        description: spec.description ?? '',
        year,
    };
}

/**
 * Builds the one immutable object every template and every `when` expression
 * reads. Frozen because a hook or a helper mutating it mid-render would break
 * the determinism the whole design rests on.
 */
export function buildContext(
    spec: ProjectSpec,
    graph: BlueprintGraph,
    options: { atarashiVersion: string; now: Date }
): RenderContext {
    const generatedAt = options.now.toISOString();
    const blueprints = graph.nodes.map((node) => ({
        id: node.blueprint.manifest.id,
        version: node.blueprint.manifest.version,
    }));
    const ids = new Set(blueprints.map((blueprint) => blueprint.id));

    const context: RenderContext = {
        project: projectFacts(spec, options.now.getUTCFullYear()),
        answers: { ...spec.answers } as Record<string, JsonValue>,
        options: spec.options,
        pm: packageManagerFacts(spec.options.packageManager),
        blueprints,
        atarashi: { version: options.atarashiVersion, generatedAt },
        has: (id: string) => ids.has(id),
        provides: (capability: string) => graph.capabilities.has(capability),
    };

    Object.freeze(context.project);
    Object.freeze(context.pm);
    Object.freeze(context.answers);
    return Object.freeze(context);
}
