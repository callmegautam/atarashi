import { AtarashiError } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { defineBlueprint, defineHooks, definePreset, toManifestJson } from '../src/index.js';

const minimal = {
    id: 'db/redis',
    name: 'Redis',
    version: '1.0.0',
    description: 'A Redis client and connection helper.',
    category: 'database',
} as const;

describe('defineBlueprint', () => {
    it('fills in the manifest version and kind this build writes', () => {
        const manifest = defineBlueprint({ ...minimal });
        expect(manifest.manifestVersion).toBe(1);
        expect(manifest.kind).toBe('blueprint');
    });

    it('applies schema defaults, so authors state only what differs', () => {
        const manifest = defineBlueprint({ ...minimal });
        expect(manifest.provides).toEqual([]);
        expect(manifest.priority).toBe(100);
        expect(manifest.license).toBe('MIT');
        expect(manifest.experimental).toBe(false);
    });

    it('keeps what the author did state', () => {
        const manifest = defineBlueprint({
            ...minimal,
            provides: ['cache'],
            requires: ['runtime:node'],
            dependencies: { ioredis: '^5.4.1' },
        });
        expect(manifest.provides).toEqual(['cache']);
        expect(manifest.dependencies).toEqual({ ioredis: '^5.4.1' });
    });

    it('throws an AtarashiError naming the offending field', () => {
        expect(() => defineBlueprint({ ...minimal, version: 'not-a-version' })).toThrow(
            AtarashiError
        );
        expect(() => defineBlueprint({ ...minimal, version: 'not-a-version' })).toThrow(/version/);
    });

    it('rejects an unknown key rather than silently dropping it', () => {
        expect(() => defineBlueprint({ ...minimal, dependancies: {} } as never)).toThrow(
            AtarashiError
        );
    });

    it('rejects a select prompt with no choices', () => {
        expect(() =>
            defineBlueprint({
                ...minimal,
                prompts: [{ name: 'db.mode', type: 'select', message: 'Mode?', flag: '--db-mode' }],
            })
        ).toThrow(/choices/);
    });
});

describe('definePreset', () => {
    it('defaults kind and manifestVersion', () => {
        const preset = definePreset({
            id: 'preset/cache-only',
            name: 'Cache only',
            description: 'Just a cache.',
            blueprints: ['db/redis'],
        });
        expect(preset.kind).toBe('preset');
        expect(preset.manifestVersion).toBe(1);
        expect(preset.version).toBe('1.0.0');
    });

    it('requires at least one blueprint', () => {
        expect(() =>
            definePreset({
                id: 'preset/empty',
                name: 'Empty',
                description: 'Nothing.',
                blueprints: [],
            })
        ).toThrow(AtarashiError);
    });
});

describe('toManifestJson', () => {
    it('leads with identity keys so a regenerated manifest diffs cleanly', () => {
        const json = toManifestJson(defineBlueprint({ ...minimal, provides: ['cache'] }));
        const keys = Object.keys(JSON.parse(json) as Record<string, unknown>);
        expect(keys.slice(0, 6)).toEqual([
            'manifestVersion',
            'kind',
            'id',
            'name',
            'version',
            'description',
        ]);
    });

    it('round-trips through the schema', () => {
        const manifest = defineBlueprint({ ...minimal, provides: ['cache'] });
        expect(defineBlueprint(JSON.parse(toManifestJson(manifest)))).toEqual(manifest);
    });

    it('ends with a newline', () => {
        expect(toManifestJson(defineBlueprint({ ...minimal }))).toMatch(/\n$/);
    });
});

describe('defineHooks', () => {
    it('returns the hooks unchanged, so it is safe as a default export', () => {
        const hooks = defineHooks({
            afterPlan(plan) {
                plan.nextSteps.push('done');
            },
        });
        expect(typeof hooks.afterPlan).toBe('function');

        const subject = { files: [], warnings: [], nextSteps: [] as string[], blueprints: [] };
        hooks.afterPlan?.(subject);
        expect(subject.nextSteps).toEqual(['done']);
    });
});
