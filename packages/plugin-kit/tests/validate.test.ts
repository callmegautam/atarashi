import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { BlueprintDefinition, ConformanceReport } from '../src/index.js';
import { defineBlueprint, toManifestJson, validateBlueprint } from '../src/index.js';

const roots: string[] = [];

afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

const base: BlueprintDefinition = {
    id: 'db/redis',
    name: 'Redis',
    version: '1.0.0',
    description: 'A Redis client and connection helper.',
    category: 'database',
};

/** Lays a blueprint out on disk as `<tmp>/<namespace>/<name>` and validates it. */
async function check(
    definition: BlueprintDefinition,
    files: Record<string, string> = {},
    options: Parameters<typeof validateBlueprint>[1] = {}
): Promise<ConformanceReport> {
    const root = await mkdtemp(join(tmpdir(), 'atarashi-bp-'));
    roots.push(root);

    const dir = join(root, ...definition.id.split('/'));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'blueprint.json'), toManifestJson(defineBlueprint(definition)));

    for (const [path, contents] of Object.entries(files)) {
        const full = join(dir, path);
        await mkdir(dirname(full), { recursive: true });
        await writeFile(full, contents);
    }
    return validateBlueprint(dir, options);
}

const errors = (report: ConformanceReport) =>
    report.problems.filter((problem) => problem.severity === 'error').map((p) => p.message);

describe('validateBlueprint', () => {
    it('passes a well-formed blueprint', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/redis.ts.hbs', to: 'src/redis.ts' }] },
            { 'files/redis.ts.hbs': 'export const name = "{{ project.slug }}";\n' }
        );
        expect(errors(report)).toEqual([]);
        expect(report.ok).toBe(true);
        expect(report.id).toBe('db/redis');
    });

    it('rejects an id that does not match its directory', async () => {
        const root = await mkdtemp(join(tmpdir(), 'atarashi-bp-'));
        roots.push(root);
        const dir = join(root, 'cache', 'redis');
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'blueprint.json'), toManifestJson(defineBlueprint(base)));

        const report = await validateBlueprint(dir);
        expect(errors(report)).toContain(
            'id "db/redis" does not match its directory ("cache/redis")'
        );
    });

    it('reports a files[].from that does not exist', async () => {
        const report = await check({
            ...base,
            files: [{ from: 'files/missing.ts.hbs', to: 'src/missing.ts' }],
        });
        expect(errors(report)).toContain('files[].from "files/missing.ts.hbs" does not exist');
    });

    it('reports a shipped file no manifest entry claims', async () => {
        const report = await check({ ...base }, { 'files/orphan.ts': 'export {};\n' });
        expect(errors(report)).toContain(
            '"files/orphan.ts" is shipped but no files[].from references it'
        );
    });

    it('rejects a committed lockfile', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/pnpm-lock.yaml', to: 'pnpm-lock.yaml' }] },
            { 'files/pnpm-lock.yaml': 'lockfileVersion: 9\n' }
        );
        expect(errors(report)).toContain(
            '"files/pnpm-lock.yaml" must not be committed inside a blueprint'
        );
    });

    it('reports a prompt with no non-interactive flag', async () => {
        const report = await check({
            ...base,
            prompts: [{ name: 'db.url', type: 'input', message: 'URL?' }],
        });
        expect(errors(report)).toContain('prompt "db.url" declares no non-interactive flag');
    });

    it('reports a `when` expression that does not parse', async () => {
        const report = await check({
            ...base,
            files: [{ from: 'files/x.ts', to: 'x.ts', when: 'answers.db.url &&' }],
        });
        expect(errors(report).join('\n')).toMatch(/files\[0\].*answers\.db\.url &&/s);
    });

    it('reports a `when` expression on an unknown binding root', async () => {
        const report = await check({
            ...base,
            files: [{ from: 'files/x.ts', to: 'x.ts', when: 'secrets.token' }],
        });
        expect(errors(report).join('\n')).toMatch(/Unknown binding `secrets`/);
    });

    it('reports a template that references something the context lacks', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts.hbs', to: 'x.ts' }] },
            { 'files/x.ts.hbs': 'export const x = "{{ nonsense.value }}";\n' }
        );
        expect(errors(report)).toContain(
            'references `nonsense.value`, which the render context does not provide'
        );
    });

    it('accepts a template that iterates an `#each` context', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.md.hbs', to: 'x.md' }] },
            { 'files/x.md.hbs': '{{#each blueprints}}- {{ id }}@{{ version }}\n{{/each}}' }
        );
        expect(errors(report)).toEqual([]);
    });

    it('accepts the curated helpers and slot partials', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts.hbs', to: 'x.ts' }] },
            {
                'files/x.ts.hbs':
                    '{{> slot "imports" }}\n{{#when "provides(\'http\')"}}ok{{else}}no{{/when}}\n{{ expr "options.author.name" }}\n',
            }
        );
        expect(errors(report)).toEqual([]);
    });

    it('rejects a slot written inline rather than alone on its line', async () => {
        // The renderer puts back the newline Handlebars eats after a standalone
        // partial; inline, the same partial would gain a stray one instead.
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts.hbs', to: 'x.ts' }] },
            { 'files/x.ts.hbs': 'const x = [{{> slot "items" }}];\n' }
        );
        expect(errors(report).join('\n')).toMatch(/must be alone on its line/);
    });

    it('reports a template that does not parse as Handlebars', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts.hbs', to: 'x.ts' }] },
            { 'files/x.ts.hbs': '{{#when "a"}}unclosed\n' }
        );
        expect(errors(report).join('\n')).toMatch(/does not parse as Handlebars/);
    });

    it('does not parse a file shipped with render: false', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.txt', to: 'x.txt', render: false }] },
            { 'files/x.txt': '{{ this is not handlebars\n' }
        );
        expect(errors(report)).toEqual([]);
    });

    it('reports an answers reference no prompt declares, when siblings are known', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts', to: 'x.ts', when: 'answers.db.pool' }] },
            { 'files/x.ts': 'export {};\n' },
            { knownPromptNames: ['auth.expiry'] }
        );
        expect(errors(report)).toContain('`answers.db.pool` is not declared by any prompt');
    });

    it('accepts an answers reference a sibling declares', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts', to: 'x.ts', when: 'answers.db.pool' }] },
            { 'files/x.ts': 'export {};\n' },
            { knownPromptNames: ['db.pool'] }
        );
        expect(errors(report)).toEqual([]);
    });

    it('only warns about an unknown answer when it cannot know the siblings', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts', to: 'x.ts', when: 'answers.db.pool' }] },
            { 'files/x.ts': 'export {};\n' }
        );
        expect(errors(report)).toEqual([]);
        expect(report.problems.map((p) => p.severity)).toContain('warning');
    });

    it('accepts an answers reference the blueprint declares itself', async () => {
        const report = await check(
            {
                ...base,
                prompts: [
                    { name: 'db.pool', type: 'confirm', message: 'Pool?', flag: '--db-pool' },
                ],
                files: [{ from: 'files/x.ts', to: 'x.ts', when: 'answers.db.pool' }],
            },
            { 'files/x.ts': 'export {};\n' },
            { knownPromptNames: ['auth.expiry'] }
        );
        expect(errors(report)).toEqual([]);
    });

    it('reports a dependency missing from the version manifest', async () => {
        const report = await check(
            { ...base, dependencies: { ioredis: {} } },
            {},
            {
                versionManifest: { express: '^4.21.2' },
            }
        );
        expect(errors(report)).toContain(
            'dependencies.ioredis has no entry in version-manifest.json'
        );
    });

    it('accepts a dependency that pins its own range', async () => {
        const report = await check(
            { ...base, dependencies: { ioredis: '^5.4.1' } },
            {},
            {
                versionManifest: { express: '^4.21.2' },
            }
        );
        expect(errors(report)).toEqual([]);
    });

    it('warns about a process.env read no blueprint declares', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts', to: 'x.ts' }] },
            { 'files/x.ts': 'export const url = process.env.REDIS_URL;\n' }
        );
        expect(report.problems.map((p) => p.message)).toContain(
            'reads `process.env.REDIS_URL`, which no blueprint declares'
        );
    });

    it('stays quiet when a sibling declares the env key', async () => {
        const report = await check(
            { ...base, files: [{ from: 'files/x.ts', to: 'x.ts' }] },
            { 'files/x.ts': 'export const url = process.env.DATABASE_URL;\n' },
            { knownEnvKeys: ['DATABASE_URL'] }
        );
        expect(report.problems).toEqual([]);
    });

    it('reports a nextSteps placeholder the context cannot resolve', async () => {
        const report = await check({ ...base, nextSteps: ['Run {{ tooling.start }}'] });
        expect(errors(report).join('\n')).toMatch(/nextSteps .* references `tooling`/);
    });

    it('accepts nextSteps that use the context and helpers', async () => {
        const report = await check({
            ...base,
            nextSteps: [
                'Run {{ pm.run }} dev{{#when "provides(\'http\')"}} --watch{{else}}{{/when}}',
            ],
        });
        expect(errors(report)).toEqual([]);
    });

    it('reports a hooks module that does not exist', async () => {
        const report = await check({
            ...base,
            hooks: { module: './hooks.js', exports: ['afterPlan'] },
        });
        expect(errors(report)).toContain('hooks.module "./hooks.js" does not exist');
    });
});
