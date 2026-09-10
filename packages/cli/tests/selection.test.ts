import type { PresetManifest } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { resolveSelection } from '../src/selection.js';

const preset: PresetManifest = {
    manifestVersion: 1,
    kind: 'preset',
    id: 'preset/backend-ts',
    name: 'TypeScript REST API',
    version: '1.0.0',
    description: 'x',
    recommended: true,
    experimental: false,
    blueprints: ['core/node-ts', 'http/express', 'db/postgres'],
    answers: { 'db.pool': true },
    tags: [],
};

describe('resolveSelection', () => {
    it('a preset seeds blueprints with reason "preset"', () => {
        const { blueprints } = resolveSelection({ preset });
        expect(blueprints).toEqual([
            { id: 'core/node-ts', reason: 'preset' },
            { id: 'http/express', reason: 'preset' },
            { id: 'db/postgres', reason: 'preset' },
        ]);
    });

    it('--remove drops a preset-provided id before --add runs', () => {
        const { blueprints } = resolveSelection({
            preset,
            remove: ['db/postgres'],
            add: ['db/mysql'],
        });
        expect(blueprints.map((b) => b.id)).toEqual(['core/node-ts', 'http/express', 'db/mysql']);
        expect(blueprints.find((b) => b.id === 'db/mysql')).toEqual({
            id: 'db/mysql',
            reason: 'user',
        });
    });

    it('a custom selection (no preset) gets reason "user"', () => {
        const { blueprints } = resolveSelection({
            custom: ['core/node-ts'],
            add: ['http/fastify'],
        });
        expect(blueprints).toEqual([
            { id: 'core/node-ts', reason: 'user' },
            { id: 'http/fastify', reason: 'user' },
        ]);
    });

    it('carries the preset answers forward', () => {
        const { answers } = resolveSelection({ preset });
        expect(answers).toEqual({ 'db.pool': true });
    });

    it('deduplicates an id present in both the base and --add', () => {
        const { blueprints } = resolveSelection({ preset, add: ['db/postgres'] });
        expect(blueprints.filter((b) => b.id === 'db/postgres')).toHaveLength(1);
    });
});
