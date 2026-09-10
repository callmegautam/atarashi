import type { ProjectSpec } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { resolve } from '../src/resolve/index.js';
import type { EngineDeps } from '../src/types.js';
import { FakeSource, specFor } from './source.js';

const deps = (source: FakeSource): EngineDeps => ({
    source,
    atarashiVersion: '1.0.0',
    nodeVersion: '20.11.0',
});

const ids = (result: Awaited<ReturnType<typeof resolve>>) => {
    if (!result.ok) throw result.error;
    return result.value.nodes.map((node) => node.blueprint.manifest.id);
};

describe('resolution', () => {
    it('resolves a single blueprint with no requirements', async () => {
        const source = new FakeSource([{ id: 'core/node-ts', provides: ['runtime:node'] }]);
        const result = await resolve(specFor(['core/node-ts']) as ProjectSpec, deps(source));
        expect(ids(result)).toEqual(['core/node-ts']);
    });

    it('auto-adds the only provider of a missing capability and says why', async () => {
        const source = new FakeSource([
            { id: 'core/node-ts', provides: ['runtime:node'], priority: 10 },
            { id: 'db/postgres', provides: ['database'], requires: ['runtime:node'] },
        ]);

        const result = await resolve(specFor(['db/postgres']) as ProjectSpec, deps(source));
        expect(ids(result)).toEqual(['core/node-ts', 'db/postgres']);
        if (!result.ok) return;

        const added = result.diagnostics.find((d) => d.code === 'ATA_AUTO_ADDED');
        expect(added?.message).toBe('+ core/node-ts (required by db/postgres → runtime:node)');
        expect(result.value.byId.get('core/node-ts')?.reason).toBe('auto');
        expect(result.value.byId.get('core/node-ts')?.requiredBy).toBe('db/postgres');
        expect(result.value.byId.get('db/postgres')?.reason).toBe('user');
    });

    it('expands requirements transitively', async () => {
        const source = new FakeSource([
            { id: 'core/node-ts', provides: ['runtime:node'], priority: 10 },
            { id: 'http/express', provides: ['http'], requires: ['runtime:node'], priority: 20 },
            { id: 'auth/jwt', requires: ['http'], priority: 30 },
        ]);

        const result = await resolve(specFor(['auth/jwt']) as ProjectSpec, deps(source));
        expect(ids(result)).toEqual(['core/node-ts', 'http/express', 'auth/jwt']);
    });

    it('does not auto-add when the requirement is already satisfied by the selection', async () => {
        const source = new FakeSource([
            { id: 'core/node-ts', provides: ['runtime:node'], priority: 10 },
            { id: 'core/node-js', provides: ['runtime:node'], priority: 10 },
            { id: 'db/postgres', provides: ['database'], requires: ['runtime:node'], priority: 20 },
        ]);

        const result = await resolve(
            specFor(['core/node-js', 'db/postgres']) as ProjectSpec,
            deps(source)
        );
        expect(ids(result)).toEqual(['core/node-js', 'db/postgres']);
    });

    it('errors with the candidate list when several blueprints provide a requirement', async () => {
        const source = new FakeSource([
            { id: 'core/node-ts', provides: ['runtime:node'] },
            { id: 'core/node-js', provides: ['runtime:node'] },
            { id: 'db/postgres', provides: ['database'], requires: ['runtime:node'] },
        ]);

        const result = await resolve(specFor(['db/postgres']) as ProjectSpec, deps(source));
        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe('ATA_AMBIGUOUS_REQUIREMENT');
        const diagnostic = result.error.diagnostics[0]!;
        expect(diagnostic.blueprints).toEqual(['db/postgres', 'core/node-js', 'core/node-ts']);
        expect(diagnostic.suggestions).toEqual([
            'Add `--add core/node-js` to choose it',
            'Add `--add core/node-ts` to choose it',
        ]);
    });

    it('errors when nothing provides a required capability', async () => {
        const source = new FakeSource([{ id: 'auth/jwt', requires: ['http'] }]);
        const result = await resolve(specFor(['auth/jwt']) as ProjectSpec, deps(source));

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_UNSATISFIED_REQUIREMENT');
        expect(result.error.diagnostics[0]?.suggestions?.[0]).toContain('--provides http');
    });

    it('names both blueprints when a capability conflict is hit', async () => {
        const source = new FakeSource([
            { id: 'db/postgres', provides: ['database', 'database:sql'], conflicts: ['database'] },
            {
                id: 'db/mongodb',
                provides: ['database', 'database:document'],
                conflicts: ['database'],
            },
        ]);

        const result = await resolve(
            specFor(['db/postgres', 'db/mongodb']) as ProjectSpec,
            deps(source)
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe('ATA_CAPABILITY_CONFLICT');
        expect(result.error.message).toBe('Cannot combine db/mongodb with db/postgres');
        expect(result.error.diagnostics[0]?.suggestions?.[0]).toBe(
            'Remove one of them: `--remove db/postgres`'
        );
    });

    it('explains a requires/provides mismatch as a pair, the way doc 03 does', async () => {
        const source = new FakeSource([
            { id: 'db/mongodb', provides: ['database', 'database:document'] },
            { id: 'orm/drizzle', requires: ['database:sql'] },
        ]);

        const result = await resolve(
            specFor(['db/mongodb', 'orm/drizzle']) as ProjectSpec,
            deps(source)
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;

        const diagnostic = result.error.diagnostics[0]!;
        expect(diagnostic.message).toBe('Cannot combine db/mongodb with orm/drizzle');
        expect(diagnostic.detail).toContain('db/mongodb  provides  database, database:document');
        expect(diagnostic.detail).toContain('orm/drizzle requires  database:sql');
    });

    it('reports an unknown blueprint with a suggestion', async () => {
        const source = new FakeSource([{ id: 'db/postgres', provides: ['db'] }]);
        const result = await resolve(specFor(['db/postgress']) as ProjectSpec, deps(source));

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_UNKNOWN_BLUEPRINT');
        expect(result.error.diagnostics[0]?.suggestions?.[0]).toBe('Did you mean `db/postgres`?');
    });
});

describe('ordering', () => {
    it('honours `after` edges', async () => {
        const source = new FakeSource([{ id: 'z/last', after: ['a/first'] }, { id: 'a/first' }]);
        const result = await resolve(specFor(['z/last', 'a/first']) as ProjectSpec, deps(source));
        expect(ids(result)).toEqual(['a/first', 'z/last']);
    });

    it('breaks ties by priority, then by id — the same order every run', async () => {
        const source = new FakeSource([
            { id: 'b/late', priority: 900 },
            { id: 'a/early', priority: 10 },
            { id: 'c/mid', priority: 100 },
            { id: 'b/mid', priority: 100 },
        ]);
        const spec = specFor(['b/late', 'c/mid', 'a/early', 'b/mid']) as ProjectSpec;

        const first = ids(await resolve(spec, deps(source)));
        const second = ids(await resolve(spec, deps(source)));
        expect(first).toEqual(['a/early', 'b/mid', 'c/mid', 'b/late']);
        expect(second).toEqual(first);
    });

    it('ignores an `after` target that is not in the graph', async () => {
        const source = new FakeSource([{ id: 'a/one', after: ['not/here'] }]);
        expect(ids(await resolve(specFor(['a/one']) as ProjectSpec, deps(source)))).toEqual([
            'a/one',
        ]);
    });

    it('reports a cycle by naming the loop', async () => {
        const source = new FakeSource([
            { id: 'a/one', after: ['b/two'] },
            { id: 'b/two', after: ['a/one'] },
        ]);

        const result = await resolve(specFor(['a/one', 'b/two']) as ProjectSpec, deps(source));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_DEPENDENCY_CYCLE');
        expect(result.error.diagnostics[0]?.message).toContain('→');
        expect(result.error.diagnostics[0]?.message).toContain('a/one');
        expect(result.error.diagnostics[0]?.message).toContain('b/two');
    });

    it('numbers nodes by graph position for deterministic merging', async () => {
        const source = new FakeSource([
            { id: 'a/one', priority: 10 },
            { id: 'b/two', priority: 20 },
        ]);
        const result = await resolve(specFor(['b/two', 'a/one']) as ProjectSpec, deps(source));
        if (!result.ok) throw result.error;
        expect(result.value.nodes.map((n) => n.order)).toEqual([0, 1]);
    });
});

describe('compatibility and hygiene', () => {
    it('refuses a blueprint that needs a newer Atarashi', async () => {
        const source = new FakeSource([{ id: 'a/one', engines: { atarashi: '>=2.0.0' } }]);
        const result = await resolve(specFor(['a/one']) as ProjectSpec, deps(source));

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_ENGINE_INCOMPATIBLE');
        expect(result.error.diagnostics[0]?.suggestions?.[0]).toContain(
            'npm install -g atarashi@latest'
        );
    });

    it('warns rather than fails on a node engine mismatch', async () => {
        const source = new FakeSource([{ id: 'a/one', engines: { node: '>=22' } }]);
        const result = await resolve(specFor(['a/one']) as ProjectSpec, deps(source));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.diagnostics.some((d) => d.severity === 'warning')).toBe(true);
    });

    it('warns about deprecated and experimental blueprints', async () => {
        const source = new FakeSource([
            { id: 'a/old', deprecated: { since: '1.3.0', use: 'a/new' } },
            { id: 'a/fresh', experimental: true },
        ]);
        const result = await resolve(specFor(['a/old', 'a/fresh']) as ProjectSpec, deps(source));

        expect(result.ok).toBe(true);
        if (!result.ok) return;
        const codes = result.diagnostics.map((d) => d.code);
        expect(codes).toContain('ATA_BLUEPRINT_DEPRECATED');
        expect(codes).toContain('ATA_BLUEPRINT_EXPERIMENTAL');
        expect(
            result.diagnostics.find((d) => d.code === 'ATA_BLUEPRINT_DEPRECATED')?.suggestions?.[0]
        ).toContain('a/new');
    });

    it('never auto-adds a deprecated blueprint', async () => {
        const source = new FakeSource([
            { id: 'a/old', provides: ['thing'], deprecated: { since: '1.0.0' } },
            { id: 'a/new', provides: ['thing'] },
            { id: 'b/needs', requires: ['thing'] },
        ]);
        expect(ids(await resolve(specFor(['b/needs']) as ProjectSpec, deps(source)))).toContain(
            'a/new'
        );
    });

    it('fails when two blueprints declare the same prompt name', async () => {
        const source = new FakeSource([
            {
                id: 'a/one',
                prompts: [{ name: 'name', type: 'input', message: 'Name', secret: false }],
            },
            {
                id: 'b/two',
                prompts: [{ name: 'name', type: 'input', message: 'Name', secret: false }],
            },
        ]);

        const result = await resolve(specFor(['a/one', 'b/two']) as ProjectSpec, deps(source));
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_PROMPT_NAME_COLLISION');
        expect(result.error.diagnostics[0]?.blueprints).toEqual(['a/one', 'b/two']);
    });

    it('indexes capabilities for the render context', async () => {
        const source = new FakeSource([
            { id: 'db/postgres', provides: ['database', 'database:sql'] },
        ]);
        const result = await resolve(specFor(['db/postgres']) as ProjectSpec, deps(source));
        if (!result.ok) throw result.error;
        expect(result.value.capabilities.get('database:sql')).toEqual(['db/postgres']);
    });
});
