import type { ProjectSpec } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import {
    buildContext,
    camel,
    constant,
    createEngine,
    defaultDestination,
    defaultMergeFor,
    findSlots,
    injectSlots,
    kebab,
    mergeImports,
    packageManagerFacts,
    pascal,
    render,
    renderSlotMarkers,
    slug,
    snake,
    words,
} from '../src/render/index.js';
import { resolve } from '../src/resolve/index.js';
import { makeContext } from './helpers.js';
import { FakeSource, specFor } from './source.js';

describe('string cases', () => {
    it.each([
        ['my-api', ['my', 'api']],
        ['myAPIServer', ['my', 'api', 'server']],
        ['My Api_server', ['my', 'api', 'server']],
        ['XMLHttpRequest', ['xml', 'http', 'request']],
    ])('splits %j into words', (input, expected) => {
        expect(words(input)).toEqual(expected);
    });

    it.each([
        ['my-api', 'MyApi', 'myApi', 'my-api', 'my_api', 'MY_API'],
        [
            'user profile',
            'UserProfile',
            'userProfile',
            'user-profile',
            'user_profile',
            'USER_PROFILE',
        ],
    ])('transforms %j', (input, p, c, k, s, con) => {
        expect(pascal(input)).toBe(p);
        expect(camel(input)).toBe(c);
        expect(kebab(input)).toBe(k);
        expect(snake(input)).toBe(s);
        expect(constant(input)).toBe(con);
    });

    it('keeps npm scopes intact when slugging', () => {
        expect(slug('@acme/My API')).toBe('@acme/my-api');
        expect(slug('My API')).toBe('my-api');
    });
});

describe('render context', () => {
    it('derives project facts and package-manager facts', async () => {
        const source = new FakeSource([{ id: 'core/node-ts', provides: ['runtime:node'] }]);
        const spec = { ...specFor(['core/node-ts']), name: 'my-api' } as ProjectSpec;
        const graph = await resolve(spec, { source, atarashiVersion: '1.0.0' });
        if (!graph.ok) throw graph.error;

        const context = buildContext(spec, graph.value, {
            atarashiVersion: '1.0.0',
            now: new Date('2026-09-07T00:00:00.000Z'),
        });

        expect(context.project.pascal).toBe('MyApi');
        expect(context.project.year).toBe(2026);
        expect(context.pm.exec).toBe('pnpm dlx');
        expect(context.has('core/node-ts')).toBe(true);
        expect(context.has('db/postgres')).toBe(false);
        expect(context.provides('runtime:node')).toBe(true);
        expect(context.atarashi.generatedAt).toBe('2026-09-07T00:00:00.000Z');
    });

    it('is frozen, so a helper or hook cannot mutate it mid-render', async () => {
        const source = new FakeSource([{ id: 'core/node-ts' }]);
        const spec = specFor(['core/node-ts']) as ProjectSpec;
        const graph = await resolve(spec, { source, atarashiVersion: '1.0.0' });
        if (!graph.ok) throw graph.error;

        const context = buildContext(spec, graph.value, {
            atarashiVersion: '1.0.0',
            now: new Date(),
        });
        expect(Object.isFrozen(context)).toBe(true);
        expect(Object.isFrozen(context.answers)).toBe(true);
    });

    it.each(['pnpm', 'npm', 'yarn', 'bun'] as const)('knows the facts for %s', (name) => {
        const facts = packageManagerFacts(name);
        expect(facts.name).toBe(name);
        expect(facts.install).toContain(name === 'yarn' ? 'yarn' : name);
        expect(facts.lockfile).toBeTruthy();
    });
});

describe('template engine', () => {
    const ctx = makeContext({
        answers: { 'db.name': 'my_api', 'db.usePool': true, entity: 'user profile' },
        has: (id) => id === 'orm/drizzle',
    });
    const run = (template: string) => createEngine('test.hbs', false).render(template, ctx);

    it('interpolates without HTML-escaping generated source', () => {
        expect(run('const a = {{ project.name }} && true;')).toBe('const a = my-api && true;');
        expect(run('{{ project.name }} & {{ pm.run }}')).toBe('my-api & pnpm run');
    });

    it('keeps the whitespace around a standalone slot partial', () => {
        // Handlebars eats the newline that ends a standalone partial's line,
        // which swallowed the blank line after a slot and stripped the trailing
        // newline from a file ending in one — both rejected by `biome check`.
        const template = 'a();\n{{> slot "imports" }}\n\nb();\n\n{{> slot "routes" }}\n';

        expect(run(template)).toBe(
            [
                'a();',
                '// #region atarashi:imports',
                '// #endregion',
                '',
                'b();',
                '',
                '// #region atarashi:routes',
                '// #endregion',
                '',
            ].join('\n')
        );
    });

    it('escapes when a file opts in', () => {
        const html = makeContext({ answers: { title: '<b>Tom & Jerry</b>' } });
        expect(createEngine('page.html', true).render('<h1>{{ answers.title }}</h1>', html)).toBe(
            '<h1>&lt;b&gt;Tom &amp; Jerry&lt;/b&gt;</h1>'
        );
        expect(createEngine('page.html', false).render('<h1>{{ answers.title }}</h1>', html)).toBe(
            '<h1><b>Tom & Jerry</b></h1>'
        );
    });

    it.each([
        ['{{#if (eq pm.name "pnpm")}}yes{{else}}no{{/if}}', 'yes'],
        ['{{#if (ne pm.name "npm")}}yes{{else}}no{{/if}}', 'yes'],
        ['{{#if (and true true)}}yes{{/if}}', 'yes'],
        ['{{#if (or false true)}}yes{{/if}}', 'yes'],
        ['{{#if (not false)}}yes{{/if}}', 'yes'],
        ['{{ case "pascal" answers.entity }}', 'UserProfile'],
        ['{{ case "constant" answers.entity }}', 'USER_PROFILE'],
        ['{{ json project.year }}', '2026'],
        ['{{ join blueprints ", " }}', ''],
    ])('supports the helper in %j', (template, expected) => {
        expect(run(template)).toBe(expected);
    });

    it('exposes `when` expressions inside templates', () => {
        expect(run('{{#when "answers.db.usePool"}}pooled{{else}}direct{{/when}}')).toBe('pooled');
        expect(run('{{#when "has(\'orm/prisma\')"}}prisma{{else}}none{{/when}}')).toBe('none');
        expect(run('{{ expr "answers.db.name" }}')).toBe('my_api');
    });

    it('supports ifHas for blueprint-conditional blocks', () => {
        expect(run("{{#ifHas 'orm/drizzle'}}drizzle{{else}}other{{/ifHas}}")).toBe('drizzle');
    });

    it('rejects an unknown case transform by name', () => {
        expect(() => run('{{ case "klingon" project.name }}')).toThrow('Unknown case');
    });

    it('has no dynamic partial lookup for blueprints to abuse', () => {
        expect(() => run('{{> (lookup . "evil") }}')).toThrow();
    });
});

describe('slots', () => {
    it('emits region markers matched to the file type', () => {
        expect(renderSlotMarkers('imports', 'src/app.ts')).toBe(
            '// #region atarashi:imports\n// #endregion'
        );
        expect(renderSlotMarkers('services', 'docker-compose.yml')).toBe(
            '# #region atarashi:services\n# #endregion'
        );
        expect(renderSlotMarkers('body', 'index.html')).toBe(
            '<!-- #region atarashi:body -->\n<!-- #endregion -->'
        );
    });

    it('finds markers and their indentation', () => {
        const file = [
            'const app = express();',
            '    // #region atarashi:routes',
            '    // #endregion',
        ].join('\n');
        const [marker] = findSlots(file);
        expect(marker).toMatchObject({ slot: 'routes', indent: '    ', startLine: 1, endLine: 2 });
    });

    it('injects contributions and leaves the markers in place for `atarashi add`', () => {
        const file = [
            '// #region atarashi:imports',
            '// #endregion',
            '',
            'const app = express();',
            '',
            '  // #region atarashi:routes',
            '  // #endregion',
        ].join('\n');

        const result = injectSlots(
            file,
            new Map([
                ['imports', ["import { db } from '@/db';"]],
                ['routes', ["app.use('/users', users);", "app.use('/auth', auth);"]],
            ])
        );

        expect(result.contents).toContain("import { db } from '@/db';");
        expect(result.contents).toContain("  app.use('/users', users);");
        expect(result.contents).toContain('// #region atarashi:imports');
        expect(result.contents).toContain('// #endregion');
        expect(result.filled.sort()).toEqual(['imports', 'routes']);
        expect(result.missing).toEqual([]);
    });

    it('deduplicates identical contributions', () => {
        const file = '// #region atarashi:bootstrap\n// #endregion';
        const result = injectSlots(
            file,
            new Map([['bootstrap', ['await db.connect();', 'await db.connect();']]])
        );
        expect(result.contents.match(/await db\.connect\(\);/g)).toHaveLength(1);
    });

    it('reports contributions to slots nobody declared, without failing', () => {
        const file = '// #region atarashi:imports\n// #endregion';
        const result = injectSlots(file, new Map([['nowhere', ['x();']]]));
        expect(result.missing).toEqual(['nowhere']);
        expect(result.contents).toBe(file);
    });

    it('is idempotent when there is nothing to inject', () => {
        const file = '// #region atarashi:imports\n// #endregion';
        expect(injectSlots(file, new Map()).contents).toBe(file);
    });

    it('separates injected imports from the code below with a blank line', () => {
        // The `#endregion` comment binds to the statement under it, so without
        // this a formatter reads the file as imports followed straight by code.
        const file = ['// #region atarashi:imports', '// #endregion', '', 'run();'].join('\n');
        const result = injectSlots(file, new Map([['imports', ["import { a } from 'a';"]]]));

        expect(result.contents.split('\n')).toEqual([
            '// #region atarashi:imports',
            "import { a } from 'a';",
            '',
            '// #endregion',
            '',
            'run();',
        ]);
    });

    it('does not stack blank lines when an already-filled imports region is re-injected', () => {
        // `atarashi add` re-injects a rendered region body verbatim.
        const file = ['// #region atarashi:imports', '// #endregion'].join('\n');
        const once = injectSlots(file, new Map([['imports', ["import { a } from 'a';"]]]));
        const twice = injectSlots(
            file,
            new Map([['imports', [once.contents.split('\n').slice(1, -1).join('\n')]]])
        );

        expect(twice.contents).toBe(once.contents);
    });
});

describe('import merging', () => {
    it('merges named imports from the same module into one statement', () => {
        expect(
            mergeImports([
                "import { db } from '@/db';",
                "import { users } from '@/db';",
                "import { auth } from '@/auth';",
            ])
        ).toEqual(["import { db, users } from '@/db';", "import { auth } from '@/auth';"]);
    });

    it('keeps a default import alongside named ones', () => {
        expect(
            mergeImports(["import express from 'express';", "import { Router } from 'express';"])
        ).toEqual(["import express, { Router } from 'express';"]);
    });

    it('deduplicates identical specifiers and sorts them', () => {
        expect(mergeImports(["import { b, a } from 'x';", "import { a } from 'x';"])).toEqual([
            "import { a, b } from 'x';",
        ]);
    });

    it('preserves side-effect and namespace imports verbatim', () => {
        expect(mergeImports(["import 'dotenv/config';"])).toEqual(["import 'dotenv/config';"]);
        expect(mergeImports(["import * as path from 'node:path';"])).toEqual([
            "import * as path from 'node:path';",
        ]);
    });

    it('passes through anything that is not an import', () => {
        expect(mergeImports(['const x = 1;'])).toEqual(['const x = 1;']);
    });
});

describe('file destinations and merge defaults', () => {
    it.each([
        ['files/src/db/index.ts.hbs', 'src/db/index.ts'],
        ['files/_gitignore', '.gitignore'],
        ['files/_github/workflows/ci.yml', '.github/workflows/ci.yml'],
        ['files/seed.sql', 'seed.sql'],
    ])('maps %j to %j', (from, expected) => {
        expect(defaultDestination(from)).toBe(expected);
    });

    it.each([
        ['package.json', 'json-deep'],
        ['tsconfig.json', 'json-deep'],
        ['.vscode/settings.json', 'json-deep'],
        ['.env.example', 'env'],
        ['.gitignore', 'lines-unique'],
        ['.dockerignore', 'lines-unique'],
        ['docker-compose.yml', 'yaml-deep'],
        ['.github/workflows/ci.yml', 'yaml-deep'],
        ['src/app.ts', 'error'],
        ['README.md', 'error'],
    ])('defaults %j to the %s strategy', (path, strategy) => {
        expect(defaultMergeFor(path)).toBe(strategy);
    });
});

describe('rendering a graph', () => {
    const build = async (blueprints: Parameters<FakeSource['add']>[0][], ids: string[]) => {
        const source = new FakeSource(blueprints);
        const spec = specFor(ids) as ProjectSpec;
        const graph = await resolve(spec, { source, atarashiVersion: '1.0.0' });
        if (!graph.ok) throw graph.error;
        const context = buildContext(spec, graph.value, {
            atarashiVersion: '1.0.0',
            now: new Date('2026-09-07T00:00:00.000Z'),
        });
        return render(graph.value, context);
    };

    const buildWith = async (
        answers: Record<string, unknown>,
        blueprints: Parameters<FakeSource['add']>[0][],
        ids: string[]
    ) => {
        const source = new FakeSource(blueprints);
        const spec = { ...specFor(ids), answers } as ProjectSpec;
        const graph = await resolve(spec, { source, atarashiVersion: '1.0.0' });
        if (!graph.ok) throw graph.error;
        const context = buildContext(spec, graph.value, {
            atarashiVersion: '1.0.0',
            now: new Date('2026-09-07T00:00:00.000Z'),
        });
        return render(graph.value, context);
    };

    it('renders templates with the context and tags each fragment with its source', async () => {
        const output = await build(
            [
                {
                    id: 'core/node-ts',
                    files: [{ from: 'files/README.md.hbs', render: true, escape: false }],
                    fileContents: { 'files/README.md.hbs': '# {{ project.name }}\n' },
                },
            ],
            ['core/node-ts']
        );

        expect(output.fragments).toHaveLength(1);
        expect(output.fragments[0]).toMatchObject({
            path: 'README.md',
            contents: '# my-api\n',
            source: 'core/node-ts',
            order: 0,
        });
    });

    it('skips files whose `when` is false', async () => {
        const output = await build(
            [
                {
                    id: 'db/postgres',
                    files: [
                        {
                            from: 'files/pool.ts',
                            when: 'answers.usePool',
                            render: true,
                            escape: false,
                        },
                        { from: 'files/index.ts', render: true, escape: false },
                    ],
                    fileContents: { 'files/pool.ts': 'pool', 'files/index.ts': 'index' },
                },
            ],
            ['db/postgres']
        );

        expect(output.fragments.map((f) => f.path)).toEqual(['index.ts']);
    });

    it('templates the destination path', async () => {
        const output = await build(
            [
                {
                    id: 'a/one',
                    files: [
                        {
                            from: 'files/model.ts.hbs',
                            to: 'src/models/{{ project.camel }}.ts',
                            render: true,
                            escape: false,
                        },
                    ],
                    fileContents: { 'files/model.ts.hbs': 'x' },
                },
            ],
            ['a/one']
        );

        expect(output.fragments[0]?.path).toBe('src/models/myApi.ts');
    });

    it('copies `render: false` files verbatim as bytes', async () => {
        const output = await build(
            [
                {
                    id: 'a/one',
                    files: [{ from: 'files/seed.sql', render: false, escape: false }],
                    fileContents: { 'files/seed.sql': 'SELECT {{ not_a_template }};' },
                },
            ],
            ['a/one']
        );

        expect(Buffer.isBuffer(output.fragments[0]?.contents)).toBe(true);
        expect(output.fragments[0]?.contents.toString()).toBe('SELECT {{ not_a_template }};');
    });

    it('applies an explicit octal mode', async () => {
        const output = await build(
            [
                {
                    id: 'a/one',
                    files: [
                        { from: 'files/entrypoint.sh', mode: '755', render: true, escape: false },
                    ],
                    fileContents: { 'files/entrypoint.sh': '#!/bin/sh\n' },
                },
            ],
            ['a/one']
        );

        expect(output.fragments[0]?.mode).toBe(0o755);
    });

    it('collects slot contributions separately from files', async () => {
        const output = await build(
            [
                {
                    id: 'db/postgres',
                    contributions: [
                        {
                            target: 'src/app.ts',
                            slot: 'imports',
                            value: "import { db } from '@/db';",
                        },
                    ],
                },
            ],
            ['db/postgres']
        );

        expect(output.fragments).toHaveLength(0);
        expect(output.slots[0]).toMatchObject({
            target: 'src/app.ts',
            slot: 'imports',
            source: 'db/postgres',
        });
    });

    it('turns a structured contribution into a mergeable fragment', async () => {
        const output = await build(
            [
                {
                    id: 'db/postgres',
                    contributions: [
                        {
                            target: 'tsconfig.json',
                            merge: 'json-deep',
                            value: { compilerOptions: { types: ['pg'] } },
                        },
                    ],
                },
            ],
            ['db/postgres']
        );

        expect(output.fragments[0]).toMatchObject({ path: 'tsconfig.json', merge: 'json-deep' });
        expect(JSON.parse(String(output.fragments[0]?.contents))).toEqual({
            compilerOptions: { types: ['pg'] },
        });
    });

    it('reports a render failure as a diagnostic instead of throwing', async () => {
        const output = await build(
            [
                {
                    id: 'a/one',
                    files: [{ from: 'files/missing.ts', render: true, escape: false }],
                },
            ],
            ['a/one']
        );

        expect(output.fragments).toHaveLength(0);
        expect(output.diagnostics[0]?.code).toBe('ATA_RENDER_FAILED');
        expect(output.diagnostics[0]?.blueprints).toEqual(['a/one']);
    });

    it('refuses a destination that escapes the target directory once templated', async () => {
        const output = await buildWith(
            { entity: '../../../etc/passwd' },
            [
                {
                    id: 'a/evil',
                    files: [
                        {
                            from: 'files/x.ts',
                            to: 'src/{{ answers.entity }}.ts',
                            render: true,
                            escape: false,
                        },
                    ],
                    fileContents: { 'files/x.ts': 'x' },
                },
            ],
            ['a/evil']
        );

        expect(output.fragments).toHaveLength(0);
        expect(output.diagnostics[0]?.code).toBe('ATA_RENDER_FAILED');
        expect(output.diagnostics[0]?.message).toContain('escapes the target directory');
    });
});
