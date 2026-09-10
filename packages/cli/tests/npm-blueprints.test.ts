import type { Registry } from '@atarashi/registry';
import { describe, expect, it } from 'vitest';
import { CliUsageError } from '../src/errors.js';
import {
    isNpmSpec,
    npmPackageName,
    partitionNpmSpecs,
    resolveNpmBlueprintIds,
} from '../src/npm-blueprints.js';

/** Only `load` is reached, so the rest of the `Registry` surface is not built. */
const fakeRegistry = (
    load: (id: string) => Promise<{ manifest: { id: string } } | undefined>
): Registry => ({ load }) as unknown as Registry;

describe('npm blueprint specs', () => {
    it('recognises and unwraps an `npm:` spec', () => {
        expect(isNpmSpec('npm:atarashi-blueprint-redis')).toBe(true);
        expect(isNpmSpec('db/postgres')).toBe(false);
        expect(npmPackageName('npm:atarashi-blueprint-redis')).toBe('atarashi-blueprint-redis');
    });

    it('splits package specs away from ordinary blueprint ids', () => {
        expect(
            partitionNpmSpecs([
                'core/node-ts',
                'npm:atarashi-blueprint-redis',
                'http/express',
                'npm:@acme/atarashi-blueprint-queue',
            ])
        ).toEqual({
            ids: ['core/node-ts', 'http/express'],
            packages: ['atarashi-blueprint-redis', '@acme/atarashi-blueprint-queue'],
        });
    });

    it('leaves a selection with no package specs untouched', () => {
        expect(partitionNpmSpecs(['db/postgres'])).toEqual({
            ids: ['db/postgres'],
            packages: [],
        });
    });

    it('resolves each package to the blueprint id its manifest declares', async () => {
        // The package is named for npm's sake; the id is what the resolver and
        // `atarashi.json` use, so it has to come from the manifest.
        const registry = fakeRegistry(async (id) =>
            id === 'npm:atarashi-blueprint-redis' ? { manifest: { id: 'acme/redis' } } : undefined
        );

        await expect(
            resolveNpmBlueprintIds(registry, ['atarashi-blueprint-redis'])
        ).resolves.toEqual(['acme/redis']);
    });

    it('turns a package that will not load into a usage error naming the install', async () => {
        const registry = fakeRegistry(() => Promise.reject(new Error('is not installed')));

        await expect(
            resolveNpmBlueprintIds(registry, ['atarashi-blueprint-redis'])
        ).rejects.toThrow(CliUsageError);
        await expect(
            resolveNpmBlueprintIds(registry, ['atarashi-blueprint-redis'])
        ).rejects.toThrow(/is not installed/);
    });

    it('reports a package that resolves to nothing', async () => {
        const registry = fakeRegistry(async () => undefined);

        await expect(
            resolveNpmBlueprintIds(registry, ['atarashi-blueprint-redis'])
        ).rejects.toThrow(/provided no blueprint/);
    });

    it('does nothing when there are no packages', async () => {
        const registry = fakeRegistry(async () => {
            throw new Error('should not be called');
        });

        await expect(resolveNpmBlueprintIds(registry, [])).resolves.toEqual([]);
    });
});
