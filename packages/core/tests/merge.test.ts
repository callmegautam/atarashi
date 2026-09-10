import { describe, expect, it } from 'vitest';
import {
    deepMerge,
    intersectRanges,
    merge,
    mergeEnv,
    mergeLinesUnique,
    mergePackageJson,
    orderPackageJson,
    parseEnv,
    sortKeys,
} from '../src/merge/index.js';
import type { FileFragment } from '../src/render/renderer.js';

const fragment = (
    path: string,
    contents: string,
    overrides: Partial<FileFragment> = {}
): FileFragment => ({
    path,
    contents,
    mode: 0o644,
    merge: 'error',
    source: 'a/one',
    order: 0,
    ...overrides,
});

describe('deep merge', () => {
    it('merges nested objects', () => {
        expect(deepMerge({ a: { b: 1 } }, { a: { c: 2 } })).toEqual({ a: { b: 1, c: 2 } });
    });

    it('unions arrays by value, preserving first-occurrence order', () => {
        expect(deepMerge({ types: ['pg'] }, { types: ['node', 'pg'] })).toEqual({
            types: ['pg', 'node'],
        });
    });

    it('lets a later scalar win', () => {
        expect(deepMerge({ strict: false }, { strict: true })).toEqual({ strict: true });
    });

    it('sorts keys recursively for deterministic output', () => {
        expect(JSON.stringify(sortKeys({ b: 1, a: { d: 1, c: 2 } }))).toBe(
            '{"a":{"c":2,"d":1},"b":1}'
        );
    });
});

describe('semver range intersection', () => {
    it.each([
        ['^8.14.1', '^8.14.1', '^8.14.1'],
        ['^8.0.0', '^8.14.1', '^8.14.1'],
        ['^8.14.1', '^8.0.0', '^8.14.1'],
        ['*', '^8.0.0', '^8.0.0'],
        ['>=8.0.0', '<9.0.0', '>=8.0.0 <9.0.0'],
    ])('narrows %s and %s to %s', (a, b, expected) => {
        expect(intersectRanges(a, b)).toBe(expected);
    });

    it('returns null when two ranges cannot both be satisfied', () => {
        expect(intersectRanges('^8.0.0', '^9.0.0')).toBeNull();
    });

    it('prefers a non-semver specifier over guessing', () => {
        expect(intersectRanges('workspace:*', '^1.0.0')).toBe('^1.0.0');
    });
});

describe('package.json merging', () => {
    it('unions dependencies and narrows overlapping ranges', () => {
        const result = mergePackageJson([
            { source: 'core/node-ts', value: { dependencies: { express: '^5.0.0' } } },
            {
                source: 'auth/jwt',
                value: { dependencies: { express: '^5.1.0', jsonwebtoken: '^9.0.0' } },
            },
        ]);

        expect(result.conflicts).toEqual([]);
        expect(result.value.dependencies).toEqual({ express: '^5.1.0', jsonwebtoken: '^9.0.0' });
    });

    it('conflicts, naming both blueprints, when ranges cannot be reconciled', () => {
        const result = mergePackageJson([
            { source: 'a/one', value: { dependencies: { pg: '^8.0.0' } } },
            { source: 'b/two', value: { dependencies: { pg: '^9.0.0' } } },
        ]);

        expect(result.conflicts).toHaveLength(1);
        expect(result.conflicts[0]).toMatchObject({
            kind: 'dependency-range',
            subject: 'pg',
            blueprints: ['a/one', 'b/two'],
        });
        expect(result.conflicts[0]?.message).toContain('pg@^8.0.0');
        expect(result.conflicts[0]?.message).toContain('pg@^9.0.0');
    });

    it('unions scripts and conflicts only when the commands differ', () => {
        const agreeing = mergePackageJson([
            { source: 'a/one', value: { scripts: { build: 'tsc' } } },
            { source: 'b/two', value: { scripts: { build: 'tsc', test: 'vitest' } } },
        ]);
        expect(agreeing.conflicts).toEqual([]);
        expect(agreeing.value.scripts).toEqual({ build: 'tsc', test: 'vitest' });

        const clashing = mergePackageJson([
            { source: 'a/one', value: { scripts: { build: 'tsc' } } },
            { source: 'b/two', value: { scripts: { build: 'tsup' } } },
        ]);
        expect(clashing.conflicts[0]).toMatchObject({ kind: 'script', subject: 'build' });
    });

    it('keeps dev and prod dependencies in separate namespaces', () => {
        const result = mergePackageJson([
            { source: 'a/one', value: { dependencies: { zod: '^3.0.0' } } },
            { source: 'b/two', value: { devDependencies: { zod: '^4.0.0' } } },
        ]);
        expect(result.conflicts).toEqual([]);
        expect(result.value.dependencies).toEqual({ zod: '^3.0.0' });
        expect(result.value.devDependencies).toEqual({ zod: '^4.0.0' });
    });

    it('applies a fixed key order and sorts dependency maps', () => {
        const ordered = orderPackageJson({
            devDependencies: { vitest: '^3.0.0', typescript: '^5.0.0' },
            scripts: { test: 'vitest', build: 'tsc' },
            name: 'my-api',
            zzz: true,
            version: '1.0.0',
        });

        expect(Object.keys(ordered)).toEqual([
            'name',
            'version',
            'scripts',
            'devDependencies',
            'zzz',
        ]);
        expect(Object.keys(ordered.devDependencies as object)).toEqual(['typescript', 'vitest']);
        expect(Object.keys(ordered.scripts as object)).toEqual(['build', 'test']);
    });

    it('takes the project name from the spec, never from a template', () => {
        const result = mergePackageJson([
            { source: 'core/node-ts', value: { name: 'configs', version: '1.0.0' } },
            { source: 'meta/readme', value: { name: 'my-api' } },
        ]);
        expect(result.value.name).toBe('my-api');
    });
});

describe('line and env merging', () => {
    it('unions .gitignore lines and labels each block by source', () => {
        const merged = mergeLinesUnique([
            { source: 'core/node-ts', contents: 'node_modules\ndist\n' },
            { source: 'db/postgres', contents: 'dist\n/pgdata\n' },
        ]);

        expect(merged).toBe('# core/node-ts\nnode_modules\ndist\n\n# db/postgres\n/pgdata\n');
    });

    it('drops a source entirely when it adds nothing new', () => {
        const merged = mergeLinesUnique([
            { source: 'a/one', contents: 'dist\n' },
            { source: 'b/two', contents: 'dist\n' },
        ]);
        expect(merged).toBe('# a/one\ndist\n');
    });

    it('parses env files including descriptions', () => {
        expect(parseEnv('# The port\nPORT=3000\n\nDATABASE_URL=postgres://x\n', 'a/one')).toEqual([
            { key: 'PORT', value: '3000', description: 'The port', source: 'a/one' },
            { key: 'DATABASE_URL', value: 'postgres://x', source: 'a/one' },
        ]);
    });

    it('unions env keys and groups them by contributing blueprint', () => {
        const result = mergeEnv([
            { key: 'PORT', value: '3000', description: 'HTTP port', source: 'http/express' },
            { key: 'DATABASE_URL', value: 'postgres://x', source: 'db/postgres' },
        ]);

        expect(result.conflicts).toEqual([]);
        expect(result.contents).toBe(
            '# http/express\n# HTTP port\nPORT=3000\n\n# db/postgres\nDATABASE_URL=postgres://x\n'
        );
    });

    it('accepts a duplicate key with the same value', () => {
        const result = mergeEnv([
            { key: 'PORT', value: '3000', source: 'a/one' },
            { key: 'PORT', value: '3000', source: 'b/two' },
        ]);
        expect(result.conflicts).toEqual([]);
    });

    it('conflicts on a duplicate key with a different value', () => {
        const result = mergeEnv([
            { key: 'PORT', value: '3000', source: 'a/one' },
            { key: 'PORT', value: '8080', source: 'b/two' },
        ]);
        expect(result.conflicts[0]).toMatchObject({ kind: 'env-value', subject: 'PORT' });
        expect(result.conflicts[0]?.suggestions?.[0]).toContain('8080');
    });
});

describe('the merger', () => {
    it('passes a single fragment through untouched', () => {
        const result = merge([fragment('src/index.ts', 'export {};')]);
        expect(result.conflicts).toEqual([]);
        expect(result.files.readText('src/index.ts')).toBe('export {};');
        expect(result.files.get('src/index.ts')?.sources).toEqual(['a/one']);
    });

    it('conflicts by default when two blueprints write one file', () => {
        const result = merge([
            fragment('src/app.ts', 'a', { source: 'a/one', order: 0 }),
            fragment('src/app.ts', 'b', { source: 'b/two', order: 1 }),
        ]);

        expect(result.files.has('src/app.ts')).toBe(false);
        expect(result.conflicts[0]).toMatchObject({ kind: 'file', subject: 'src/app.ts' });
        expect(result.conflicts[0]?.blueprints).toEqual(['a/one', 'b/two']);
        expect(result.conflicts[0]?.suggestions?.length).toBeGreaterThan(0);
    });

    it('lets the last fragment win under `overwrite`, and says so', () => {
        const result = merge([
            fragment('README.md', 'first', { source: 'a/one', order: 0, merge: 'overwrite' }),
            fragment('README.md', 'second', { source: 'b/two', order: 1, merge: 'overwrite' }),
        ]);

        expect(result.files.readText('README.md')).toBe('second');
        expect(result.diagnostics[0]?.code).toBe('ATA_OVERWRITTEN_FILE');
    });

    it('merges package.json fragments through the specialised merger', () => {
        const result = merge([
            fragment('package.json', '{"name":"my-api","dependencies":{"express":"^5.0.0"}}', {
                source: 'core/node-ts',
                order: 0,
                merge: 'json-deep',
            }),
            fragment('package.json', '{"dependencies":{"pg":"^8.0.0"}}', {
                source: 'db/postgres',
                order: 1,
                merge: 'json-deep',
            }),
        ]);

        const parsed = JSON.parse(result.files.readText('package.json')!);
        expect(parsed.dependencies).toEqual({ express: '^5.0.0', pg: '^8.0.0' });
        expect(Object.keys(parsed)).toEqual(['name', 'dependencies']);
    });

    it('deep-merges other json and sorts keys', () => {
        const result = merge([
            fragment('tsconfig.json', '{"compilerOptions":{"strict":true}}', {
                merge: 'json-deep',
                order: 0,
            }),
            fragment('tsconfig.json', '{"compilerOptions":{"types":["pg"]}}', {
                source: 'b/two',
                merge: 'json-deep',
                order: 1,
            }),
        ]);

        expect(JSON.parse(result.files.readText('tsconfig.json')!)).toEqual({
            compilerOptions: { strict: true, types: ['pg'] },
        });
    });

    it('reports invalid JSON as a conflict on the file, naming the blueprint', () => {
        const result = merge([
            fragment('tsconfig.json', '{"a":1}', { merge: 'json-deep', order: 0 }),
            fragment('tsconfig.json', '{oops', { source: 'b/two', merge: 'json-deep', order: 1 }),
        ]);

        expect(result.files.has('tsconfig.json')).toBe(false);
        expect(result.conflicts[0]?.message).toContain('b/two produced invalid JSON');
    });

    it('deep-merges yaml', () => {
        const result = merge([
            fragment('docker-compose.yml', 'services:\n  api:\n    image: node\n', {
                merge: 'yaml-deep',
                order: 0,
            }),
            fragment('docker-compose.yml', 'services:\n  db:\n    image: postgres\n', {
                source: 'b/two',
                merge: 'yaml-deep',
                order: 1,
            }),
        ]);

        expect(result.files.readText('docker-compose.yml')).toContain('api:');
        expect(result.files.readText('docker-compose.yml')).toContain('db:');
    });

    it('merges env files at the key level', () => {
        const result = merge([
            fragment('.env.example', 'PORT=3000\n', { merge: 'env', order: 0 }),
            fragment('.env.example', 'DATABASE_URL=x\n', {
                source: 'b/two',
                merge: 'env',
                order: 1,
            }),
        ]);

        expect(result.files.readText('.env.example')).toContain('PORT=3000');
        expect(result.files.readText('.env.example')).toContain('DATABASE_URL=x');
    });

    it('concatenates under append and prepend, in graph order', () => {
        const appended = merge([
            fragment('README.md', 'first', { merge: 'append', order: 0 }),
            fragment('README.md', 'second', { source: 'b/two', merge: 'append', order: 1 }),
        ]);
        expect(appended.files.readText('README.md')).toBe('first\n\nsecond\n');

        const prepended = merge([
            fragment('README.md', 'first', { merge: 'prepend', order: 0 }),
            fragment('README.md', 'second', { source: 'b/two', merge: 'prepend', order: 1 }),
        ]);
        expect(prepended.files.readText('README.md')).toBe('second\n\nfirst\n');
    });

    it('respects graph order regardless of the order fragments arrive in', () => {
        const result = merge([
            fragment('README.md', 'later', { source: 'b/two', merge: 'append', order: 5 }),
            fragment('README.md', 'earlier', { source: 'a/one', merge: 'append', order: 1 }),
        ]);
        expect(result.files.readText('README.md')).toBe('earlier\n\nlater\n');
    });

    it('refuses two blueprints writing the same binary file', () => {
        const result = merge([
            { ...fragment('public/favicon.ico', ''), contents: Buffer.from([1]), order: 0 },
            {
                ...fragment('public/favicon.ico', ''),
                contents: Buffer.from([2]),
                source: 'b/two',
                order: 1,
            },
        ]);
        expect(result.conflicts[0]?.message).toContain('binary file');
    });

    it('catches a case-only collision before it reaches disk', () => {
        const result = merge([
            fragment('README.md', 'a', { order: 0 }),
            fragment('readme.md', 'b', { source: 'b/two', order: 1 }),
        ]);

        expect(result.conflicts[0]?.message).toContain('differ only by case');
    });

    it('takes the most permissive mode when fragments disagree', () => {
        const result = merge([
            fragment('run.sh', '#!/bin/sh', { merge: 'append', order: 0, mode: 0o644 }),
            fragment('run.sh', 'echo hi', {
                source: 'b/two',
                merge: 'append',
                order: 1,
                mode: 0o755,
            }),
        ]);
        expect(result.files.get('run.sh')?.mode).toBe(0o755);
    });
});

describe('slot injection through the merger', () => {
    const base = [
        "import express from 'express';",
        '// #region atarashi:imports',
        '// #endregion',
        '',
        'const app = express();',
        '// #region atarashi:routes',
        '// #endregion',
    ].join('\n');

    it('injects contributions into the merged file', () => {
        const result = merge(
            [fragment('src/app.ts', base, { source: 'http/express', order: 0 })],
            [
                {
                    target: 'src/app.ts',
                    slot: 'imports',
                    value: "import { db } from '@/db';",
                    source: 'db/postgres',
                    order: 1,
                },
                {
                    target: 'src/app.ts',
                    slot: 'routes',
                    value: "app.use('/health', health);",
                    source: 'db/postgres',
                    order: 1,
                },
            ]
        );

        const contents = result.files.readText('src/app.ts')!;
        expect(contents).toContain("import { db } from '@/db';");
        expect(contents).toContain("app.use('/health', health);");
        expect(result.conflicts).toEqual([]);
    });

    it('orders contributions by graph position, not by arrival', () => {
        const result = merge(
            [fragment('src/app.ts', base, { source: 'http/express', order: 0 })],
            [
                {
                    target: 'src/app.ts',
                    slot: 'routes',
                    value: 'second();',
                    source: 'c/three',
                    order: 3,
                },
                {
                    target: 'src/app.ts',
                    slot: 'routes',
                    value: 'first();',
                    source: 'b/two',
                    order: 1,
                },
            ]
        );

        const contents = result.files.readText('src/app.ts')!;
        expect(contents.indexOf('first();')).toBeLessThan(contents.indexOf('second();'));
    });

    it('warns, rather than fails, when the target file does not exist', () => {
        const result = merge(
            [],
            [
                {
                    target: 'src/app.ts',
                    slot: 'routes',
                    value: 'x();',
                    source: 'db/postgres',
                    order: 0,
                },
            ]
        );

        expect(result.conflicts).toEqual([]);
        expect(result.diagnostics[0]?.code).toBe('ATA_UNDECLARED_SLOT');
        expect(result.diagnostics[0]?.message).toContain('which no blueprint generates');
    });

    it('warns when the file exists but declares no such slot', () => {
        const result = merge(
            [fragment('src/app.ts', base, { source: 'http/express', order: 0 })],
            [
                {
                    target: 'src/app.ts',
                    slot: 'middleware',
                    value: 'app.use(helmet());',
                    source: 'mw/helmet',
                    order: 1,
                },
            ]
        );

        expect(result.conflicts).toEqual([]);
        expect(result.diagnostics[0]?.message).toContain('declares no `middleware` slot');
    });
});

/**
 * Doc 09 § T3, as a security boundary. An install script is the one thing in a
 * generated project that runs without the user asking, so an untrusted
 * blueprint must not be able to add one by any route. These must never be
 * skipped.
 */
describe('T3 — install scripts from untrusted blueprints (security boundary)', () => {
    const packageJson = (scripts: Record<string, string>, source: string): FileFragment =>
        fragment('package.json', JSON.stringify({ name: 'app', scripts }), {
            merge: 'json-deep',
            source,
        });

    it.each(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish'])(
        'refuses `%s` from a blueprint the registry did not trust',
        (script) => {
            const result = merge(
                [packageJson({ [script]: 'node -e "…"' }, 'evil/hack')],
                [],
                new Set(['evil/hack'])
            );

            const errors = result.diagnostics.filter((d) => d.severity === 'error');
            expect(errors).toHaveLength(1);
            expect(errors[0]?.message).toContain(script);
            expect(errors[0]?.message).toContain('evil/hack');
        }
    );

    it('catches it whichever fragment carries it — manifest, contribution or template', () => {
        // All three routes arrive here as a `package.json` fragment; the point
        // of checking at the merge is that none of them is special.
        const result = merge(
            [
                packageJson({ postinstall: 'a' }, 'evil/one'),
                packageJson({ preinstall: 'b' }, 'evil/two'),
            ],
            [],
            new Set(['evil/one', 'evil/two'])
        );

        expect(result.diagnostics.filter((d) => d.severity === 'error')).toHaveLength(2);
    });

    it('allows an ordinary script from an untrusted blueprint', () => {
        const result = merge(
            [packageJson({ dev: 'vite' }, 'community/thing')],
            [],
            new Set(['community/thing'])
        );

        expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    });

    it('allows an install script from a trusted blueprint', () => {
        // `orm/prisma` needs `postinstall: prisma generate`, is reviewed in this
        // repo, and the plan shows it before anything installs. Trust is the
        // line, not the script name.
        const result = merge([packageJson({ postinstall: 'prisma generate' }, 'orm/prisma')]);

        expect(result.diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
    });

    it('ignores a `package.json` that does not parse, leaving that to validation', () => {
        const result = merge(
            [fragment('package.json', '{ not json', { merge: 'json-deep', source: 'evil/hack' })],
            [],
            new Set(['evil/hack'])
        );

        expect(result.diagnostics.filter((d) => d.message.includes('runs automatically'))).toEqual(
            []
        );
    });
});
