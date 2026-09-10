import type { ProjectSpec } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { generate } from '../src/generate.js';
import type { EngineDeps } from '../src/types.js';
import { type FakeBlueprintInput, FakeSource, specFor } from './source.js';

const NOW = new Date('2026-09-07T00:00:00.000Z');
const deps = (source: FakeSource): EngineDeps => ({
    source,
    atarashiVersion: '1.0.0',
    nodeVersion: '20.11.0',
    now: () => NOW,
});

const nodeTs = {
    id: 'core/node-ts',
    provides: ['runtime:node', 'language:typescript'],
    priority: 10,
    dependencies: {},
    devDependencies: { typescript: '^5.9.0' },
    scripts: { build: 'tsc' },
    gitignore: ['node_modules', 'dist'],
    files: [
        { from: 'files/src/app.ts.hbs', render: true, escape: false },
        { from: 'files/tsconfig.json', render: true, escape: false },
    ],
    fileContents: {
        'files/src/app.ts.hbs': [
            "import express from 'express';",
            '{{> slot "imports" }}',
            '',
            'export const app = express();',
            '{{> slot "bootstrap" }}',
            '',
        ].join('\n'),
        'files/tsconfig.json': '{ "compilerOptions": { "strict": true } }',
    },
    nextSteps: ['Run {{ pm.run }} build'],
};

const postgres = {
    id: 'db/postgres',
    provides: ['database', 'database:sql'],
    conflicts: ['database'],
    requires: ['runtime:node'],
    after: ['core/node-ts'],
    priority: 50,
    dependencies: { pg: '^8.14.1' },
    scripts: { 'db:up': 'docker compose up -d db' },
    gitignore: ['/pgdata', 'dist'],
    env: [
        {
            key: 'DATABASE_URL',
            sample: 'postgresql://localhost:5432/{{ project.slug }}',
            description: 'PostgreSQL connection string',
            required: true,
            secret: false,
        },
    ],
    contributions: [
        { target: 'src/app.ts', slot: 'imports', value: "import { db } from './db.js';" },
        { target: 'src/app.ts', slot: 'bootstrap', value: 'await db.connect();' },
        {
            target: 'tsconfig.json',
            merge: 'json-deep' as const,
            value: { compilerOptions: { types: ['pg'] } },
        },
    ],
    files: [{ from: 'files/src/db.ts.hbs', render: true, escape: false }],
    fileContents: {
        'files/src/db.ts.hbs': 'export const url = process.env.DATABASE_URL;\n',
    },
    nextSteps: ['Start the database: {{ pm.run }} db:up'],
};

const run = (blueprints: Parameters<FakeSource['add']>[0][], ids: string[], overrides = {}) => {
    const source = new FakeSource(blueprints);
    return generate({ ...specFor(ids), ...overrides } as ProjectSpec, deps(source));
};

describe('generate', () => {
    it('produces a coherent plan from two composed blueprints', async () => {
        const result = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres']);
        expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
        if (!result.ok) return;

        const plan = result.value;
        expect(plan.files.map((file) => file.path)).toEqual([
            '.env.example',
            '.gitignore',
            'atarashi.json',
            'package.json',
            'src/app.ts',
            'src/db.ts',
            'tsconfig.json',
        ]);
        expect(plan.conflicts).toEqual([]);
    });

    it('names package.json from the project, not from a blueprint', async () => {
        const result = await run([{ ...nodeTs, files: [], fileContents: {} }], ['core/node-ts'], {
            name: 'my-api',
        });
        if (!result.ok) throw result.error;

        const packageJson = JSON.parse(
            String(result.value.files.find((file) => file.path === 'package.json')!.contents)
        );
        expect(packageJson.name).toBe('my-api');
        expect(packageJson.type).toBe('module');
        expect(packageJson.devDependencies).toEqual({ typescript: '^5.9.0' });
        expect(packageJson.scripts).toEqual({ build: 'tsc' });
        expect(Object.keys(packageJson)).toEqual([
            'name',
            'version',
            'private',
            'license',
            'type',
            'scripts',
            'devDependencies',
        ]);
    });

    it('injects slot contributions into the base template', async () => {
        const result = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres']);
        if (!result.ok) throw result.error;

        const app = String(result.value.files.find((file) => file.path === 'src/app.ts')!.contents);
        expect(app).toContain("import { db } from './db.js';");
        expect(app).toContain('await db.connect();');
        expect(app).toContain('// #region atarashi:imports');
    });

    it('merges tsconfig contributions into the base file', async () => {
        const result = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres']);
        if (!result.ok) throw result.error;

        expect(
            JSON.parse(String(result.value.files.find((f) => f.path === 'tsconfig.json')!.contents))
        ).toEqual({ compilerOptions: { strict: true, types: ['pg'] } });
    });

    it('unions gitignore lines across blueprints without duplicating', async () => {
        const result = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres']);
        if (!result.ok) throw result.error;

        const contents = String(result.value.files.find((f) => f.path === '.gitignore')!.contents);
        expect(contents.match(/^dist$/gm)).toHaveLength(1);
        expect(contents).toContain('/pgdata');
    });

    it('renders env samples with the context and fixes the PORT=DEMO problem', async () => {
        const result = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres'], {
            name: 'my-api',
        });
        if (!result.ok) throw result.error;

        const env = String(result.value.files.find((f) => f.path === '.env.example')!.contents);
        expect(env).toContain('DATABASE_URL=postgresql://localhost:5432/my-api');
        expect(env).toContain('# PostgreSQL connection string');
    });

    it('warns about an env key a template reads but nobody declared', async () => {
        const result = await run(
            [
                {
                    ...nodeTs,
                    files: [{ from: 'files/config.ts', render: true, escape: false }],
                    fileContents: { 'files/config.ts': 'export const port = process.env.PORT;\n' },
                },
            ],
            ['core/node-ts']
        );
        if (!result.ok) throw result.error;

        const undeclared = result.value.warnings.find(
            (diagnostic) => diagnostic.code === 'ATA_UNDECLARED_ENV_KEY'
        );
        expect(undeclared?.message).toContain('process.env.PORT');
        expect(undeclared?.suggestions?.[0]).toContain('`env` list');
    });

    it('writes atarashi.json so the project can be regenerated', async () => {
        const result = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres'], {
            answers: { 'db.usePool': true },
        });
        if (!result.ok) throw result.error;

        const config = JSON.parse(
            String(result.value.files.find((file) => file.path === 'atarashi.json')!.contents)
        );
        expect(config).toMatchObject({
            specVersion: 1,
            atarashiVersion: '1.0.0',
            generatedAt: '2026-09-07T00:00:00.000Z',
            name: 'my-api',
            blueprints: [
                { id: 'core/node-ts', version: '1.0.0' },
                { id: 'db/postgres', version: '1.0.0' },
            ],
            answers: { 'db.usePool': true },
        });
    });

    it('summarises dependencies with the blueprint that asked for each', async () => {
        const result = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres']);
        if (!result.ok) throw result.error;

        expect(result.value.summary.deps.dependencies).toEqual([
            { name: 'pg', range: '^8.14.1', dev: false, requestedBy: ['db/postgres'] },
        ]);
        expect(result.value.summary.deps.devDependencies[0]?.requestedBy).toEqual(['core/node-ts']);
        expect(result.value.summary.blueprints).toHaveLength(2);
        expect(result.value.summary.fileCount).toBe(result.value.files.length);
    });

    it('collects and renders next steps from every blueprint', async () => {
        const result = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres']);
        if (!result.ok) throw result.error;

        expect(result.value.summary.nextSteps).toContain('Run pnpm run build');
        expect(result.value.summary.nextSteps).toContain('Start the database: pnpm run db:up');
    });

    it('prefers a registry-pinned dependency range over the blueprint’s own', async () => {
        const source = new FakeSource([postgres, nodeTs]).pin('pg', '^8.16.0');
        const result = await generate(
            specFor(['core/node-ts', 'db/postgres']) as ProjectSpec,
            deps(source)
        );
        if (!result.ok) throw result.error;

        expect(result.value.summary.deps.dependencies[0]?.range).toBe('^8.16.0');
    });

    it('builds post-actions in a fixed order, marking the disabled ones', async () => {
        const result = await run([nodeTs], ['core/node-ts'], {
            options: { ...specFor([]).options, install: false },
        });
        if (!result.ok) throw result.error;

        expect(result.value.actions.map((action) => action.kind)).toEqual([
            'git-init',
            'install',
            'format',
            'git-commit',
        ]);
        const install = result.value.actions.find((action) => action.kind === 'install')!;
        expect(install.skipped).toBe(true);
        expect(install.skipReason).toBe('--no-install');
        expect(result.value.summary.nextSteps[0]).toBe('Install dependencies:  pnpm install');
    });

    it('is deterministic: the same spec produces byte-identical output', async () => {
        const spec = specFor(['core/node-ts', 'db/postgres']) as ProjectSpec;
        const first = await generate(spec, deps(new FakeSource([nodeTs, postgres])));
        const second = await generate(spec, deps(new FakeSource([postgres, nodeTs])));

        if (!first.ok || !second.ok) throw new Error('expected both to succeed');
        expect(second.value.files.map((f) => [f.path, String(f.contents)])).toEqual(
            first.value.files.map((f) => [f.path, String(f.contents)])
        );
    });

    it('fails with a conflict rather than returning a plan nobody should write', async () => {
        const clashing = [
            { ...nodeTs, id: 'a/one', after: [], provides: [], requires: [] },
            {
                id: 'b/two',
                files: [{ from: 'files/src/app.ts.hbs', render: true, escape: false }],
                fileContents: { 'files/src/app.ts.hbs': 'different content' },
            },
        ];

        const result = await run(clashing, ['a/one', 'b/two']);
        expect(result.ok).toBe(false);
        if (result.ok) return;

        expect(result.error.code).toBe('ATA_MERGE_CONFLICT');
        expect(result.error.message).toContain('src/app.ts');
        expect(result.error.diagnostics[0]?.suggestions?.length).toBeGreaterThan(0);
    });

    it('surfaces a resolution failure without rendering anything', async () => {
        const result = await run([{ id: 'auth/jwt', requires: ['http'] }], ['auth/jwt']);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_UNSATISFIED_REQUIREMENT');
    });

    it('reports a template failure as an error, not a crash', async () => {
        const result = await run(
            [{ id: 'a/one', files: [{ from: 'files/gone.ts', render: true, escape: false }] }],
            ['a/one']
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_RENDER_FAILED');
    });

    it('carries resolver diagnostics through to the caller', async () => {
        const result = await run(
            [
                { ...nodeTs, priority: 10 },
                { ...postgres, id: 'db/postgres', experimental: true },
            ],
            ['db/postgres']
        );
        if (!result.ok) throw result.error;

        expect(result.diagnostics.some((d) => d.code === 'ATA_AUTO_ADDED')).toBe(true);
        expect(result.diagnostics.some((d) => d.code === 'ATA_BLUEPRINT_EXPERIMENTAL')).toBe(true);
    });

    it('writes a .env alongside .env.example only when asked', async () => {
        const withoutEnv = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres']);
        if (!withoutEnv.ok) throw withoutEnv.error;
        expect(withoutEnv.value.files.some((file) => file.path === '.env')).toBe(false);

        const withEnv = await run([nodeTs, postgres], ['core/node-ts', 'db/postgres'], {
            options: { ...specFor([]).options, writeEnv: true },
        });
        if (!withEnv.ok) throw withEnv.error;
        expect(withEnv.value.files.some((file) => file.path === '.env')).toBe(true);
    });

    it('leaves secret env values blank in the committed example', async () => {
        const result = await run(
            [
                {
                    ...nodeTs,
                    env: [
                        {
                            key: 'JWT_SECRET',
                            sample: 'super-secret',
                            required: true,
                            secret: true,
                        },
                    ],
                },
            ],
            ['core/node-ts']
        );
        if (!result.ok) throw result.error;

        const env = String(result.value.files.find((f) => f.path === '.env.example')!.contents);
        expect(env).toContain('JWT_SECRET=');
        expect(env).not.toContain('super-secret');
    });

    it('mints a real value in `.env` for an entry that declares `generate`', async () => {
        // Without this the generated project stops on its own env validation:
        // `.env.example` must not carry a signing key, but `.env` needs one.
        const withSecret = {
            ...nodeTs,
            env: [
                {
                    key: 'JWT_SECRET',
                    sample: 'generate with: openssl rand -hex 32',
                    required: true,
                    secret: true,
                    generate: 'hex-32' as const,
                },
            ],
        };
        const options = { ...specFor([]).options, writeEnv: true };

        const first = await run([withSecret], ['core/node-ts'], { options });
        const second = await run([withSecret], ['core/node-ts'], { options });
        if (!first.ok) throw first.error;
        if (!second.ok) throw second.error;

        const secretIn = (result: typeof first) =>
            /^JWT_SECRET=(.*)$/m.exec(
                String(result.value.files.find((f) => f.path === '.env')!.contents)
            )?.[1] ?? '';

        expect(secretIn(first)).toMatch(/^[0-9a-f]{64}$/);
        // The one value that is deliberately not reproducible run to run.
        expect(secretIn(first)).not.toBe(secretIn(second));

        // The committed example still shows nothing.
        const example = String(first.value.files.find((f) => f.path === '.env.example')!.contents);
        expect(example).toMatch(/^JWT_SECRET=$/m);
    });
});

/**
 * Doc 09 § T3. The version manifest is reviewed and PR-gated, so it is what
 * bounds the packages an untrusted blueprint can pull into a user's project.
 * Must never be skipped.
 */
describe('T3 — dependencies from untrusted blueprints (security boundary)', () => {
    // Built from nothing rather than spread from `nodeTs`, so it contributes
    // only the dependency under test — no files to collide, no inherited deps.
    const community = (
        dependencies: FakeBlueprintInput['dependencies'],
        trusted = false
    ): FakeBlueprintInput => ({
        id: 'community/thing',
        trusted,
        dependencies,
    });

    it('refuses a package the registry does not pin', async () => {
        const result = await run(
            [nodeTs, community({ 'totally-not-malware': '^9.9.9' })],
            ['core/node-ts', 'community/thing']
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toContain('totally-not-malware');
        expect(result.error.message).toContain('community/thing');
    });

    it('refuses it however the range is written', async () => {
        const result = await run(
            [nodeTs, community({ 'totally-not-malware': { version: '^9.9.9' } })],
            ['core/node-ts', 'community/thing']
        );

        expect(result.ok).toBe(false);
    });

    it('allows a package the registry pins, at the reviewed range', async () => {
        const source = new FakeSource([nodeTs, community({ express: '^3.0.0' })]);
        source.pin('express', '^4.21.2');

        const result = await generate(
            specFor(['core/node-ts', 'community/thing']) as ProjectSpec,
            deps(source)
        );

        expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
        if (!result.ok) return;
        // The reviewed range wins over what the blueprint asked for.
        expect(
            result.value.summary.deps.dependencies.find((d) => d.name === 'express')?.range
        ).toBe('^4.21.2');
    });

    it('lets a trusted blueprint pin its own range', async () => {
        const result = await run(
            [nodeTs, community({ 'some-package': '^1.0.0' }, true)],
            ['core/node-ts', 'community/thing']
        );

        expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
    });
});
