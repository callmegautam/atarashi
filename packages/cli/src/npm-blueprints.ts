import type { Registry } from '@atarashi/registry';
import { CliUsageError } from './errors.js';

const NPM_PREFIX = 'npm:';

export const isNpmSpec = (id: string): boolean => id.startsWith(NPM_PREFIX);

/** `npm:atarashi-blueprint-redis` → `atarashi-blueprint-redis`. */
export const npmPackageName = (spec: string): string => spec.slice(NPM_PREFIX.length);

/**
 * Splits `--add` values into ordinary blueprint ids and `npm:` package specs.
 * The registry has to know about the packages before it can resolve anything
 * from them, and `buildRegistry` is called before the rest of the selection is
 * worked out, so the split happens on the raw flags.
 */
export function partitionNpmSpecs(ids: string[]): { ids: string[]; packages: string[] } {
    const packages: string[] = [];
    const plain: string[] = [];
    for (const id of ids) {
        if (isNpmSpec(id)) packages.push(npmPackageName(id));
        else plain.push(id);
    }
    return { ids: plain, packages };
}

/**
 * Resolves each `npm:` spec to the blueprint id its manifest declares, so the
 * rest of the pipeline only ever sees `namespace/name`. A community package is
 * named for npm's sake; the id is what the resolver and `atarashi.json` use.
 */
export async function resolveNpmBlueprintIds(
    registry: Registry,
    packages: string[]
): Promise<string[]> {
    const ids: string[] = [];
    for (const name of packages) {
        const loaded = await registry.load(`${NPM_PREFIX}${name}`).catch((cause: unknown) => {
            throw new CliUsageError(
                `Could not load blueprint package \`${name}\`: ${(cause as Error).message}`,
                [
                    `Install it first:  npm install ${name}`,
                    'Community blueprint packages must be named `atarashi-blueprint-*`',
                ]
            );
        });
        if (!loaded) {
            throw new CliUsageError(`\`${name}\` provided no blueprint`, [
                `Install it first:  npm install ${name}`,
            ]);
        }
        ids.push(loaded.manifest.id);
    }
    return ids;
}
