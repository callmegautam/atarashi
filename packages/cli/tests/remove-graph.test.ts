import type { LoadedBlueprint } from '@atarashi/core';
import { describe, expect, it } from 'vitest';
import { findBlockers, findOrphans } from '../src/commands/remove.js';

type Manifest = LoadedBlueprint['manifest'];

const graph = (
    entries: { id: string; provides?: string[]; requires?: string[] }[]
): Map<string, Manifest> =>
    new Map(
        entries.map((entry) => [
            entry.id,
            {
                id: entry.id,
                provides: entry.provides ?? [],
                requires: entry.requires ?? [],
                prompts: [],
            } as unknown as Manifest,
        ])
    );

const project = graph([
    { id: 'core/node-ts', provides: ['runtime:node', 'lang:ts'] },
    { id: 'db/postgres', provides: ['database:sql'], requires: ['runtime:node'] },
    { id: 'orm/drizzle', provides: ['orm'], requires: ['database:sql'] },
    { id: 'auth/jwt', provides: ['auth'], requires: ['runtime:node'] },
]);

describe('findBlockers', () => {
    it('names the blueprint that still needs what is being removed', () => {
        expect(findBlockers(project, new Set(['db/postgres']))).toEqual([
            { blueprint: 'orm/drizzle', capability: 'database:sql', providedBy: 'db/postgres' },
        ]);
    });

    it('lets a dependent go together with what it depends on', () => {
        expect(findBlockers(project, new Set(['db/postgres', 'orm/drizzle']))).toEqual([]);
    });

    it('allows removing a leaf', () => {
        expect(findBlockers(project, new Set(['auth/jwt']))).toEqual([]);
    });
});

describe('findOrphans', () => {
    it('points at what was only there for the removed blueprint', () => {
        expect(findOrphans(project, new Set(['orm/drizzle']))).toEqual(['db/postgres']);
    });

    it('does not flag a provider something else still uses', () => {
        expect(findOrphans(project, new Set(['auth/jwt']))).toEqual([]);
    });
});
