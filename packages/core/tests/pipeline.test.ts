import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ProjectSpec } from '@atarashi/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { type Executor, runActions } from '../src/actions/index.js';
import { generate } from '../src/generate.js';
import { commit } from '../src/write/index.js';
import { FakeSource, specFor } from './source.js';

const roots: string[] = [];
const scratch = () => {
    const dir = mkdtempSync(join(tmpdir(), 'atarashi-e2e-'));
    roots.push(dir);
    return dir;
};
afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const source = () =>
    new FakeSource([
        {
            id: 'core/node-ts',
            provides: ['runtime:node'],
            priority: 10,
            devDependencies: { typescript: '^5.9.0' },
            scripts: { build: 'tsc', dev: 'tsx watch src/index.ts' },
            gitignore: ['node_modules', 'dist'],
            files: [
                { from: 'files/src/index.ts.hbs', render: true, escape: false },
                { from: 'files/_gitignore', render: true, escape: false },
                { from: 'files/bin/start.sh', mode: '755', render: true, escape: false },
            ],
            fileContents: {
                'files/src/index.ts.hbs':
                    'export const name = \'{{ project.name }}\';\n{{> slot "bootstrap" }}\n',
                'files/_gitignore': 'coverage\n',
                'files/bin/start.sh': '#!/bin/sh\nnode dist/index.js\n',
            },
            env: [
                {
                    key: 'PORT',
                    sample: '3000',
                    description: 'HTTP port',
                    required: true,
                    secret: false,
                },
            ],
            nextSteps: ['Start it with {{ pm.run }} dev'],
        },
        {
            id: 'infra/docker',
            requires: ['runtime:node'],
            after: ['core/node-ts'],
            priority: 60,
            gitignore: ['/pgdata'],
            contributions: [
                { target: 'src/index.ts', slot: 'bootstrap', value: 'console.log("ready");' },
            ],
            files: [{ from: 'files/Dockerfile', render: true, escape: false }],
            fileContents: { 'files/Dockerfile': 'FROM node:20\nWORKDIR /app\n' },
        },
    ]);

const spec = (overrides = {}): ProjectSpec =>
    ({ ...specFor(['core/node-ts', 'infra/docker']), name: 'my-api', ...overrides }) as ProjectSpec;

describe('generate → commit → actions', () => {
    it('writes a coherent project to disk', async () => {
        const plan = await generate(spec(), {
            source: source(),
            atarashiVersion: '1.0.0',
            now: () => new Date('2026-09-07T00:00:00.000Z'),
        });
        if (!plan.ok) throw plan.error;

        const target = join(scratch(), 'my-api');
        const written = commit(plan.value, target);
        expect(written.ok, written.ok ? '' : written.error.message).toBe(true);

        expect(readdirSync(target).sort()).toEqual([
            '.env.example',
            '.gitignore',
            'Dockerfile',
            'atarashi.json',
            'bin',
            'package.json',
            'src',
        ]);

        expect(readFileSync(join(target, 'src/index.ts'), 'utf8')).toContain(
            "export const name = 'my-api';"
        );
        expect(readFileSync(join(target, 'src/index.ts'), 'utf8')).toContain(
            'console.log("ready");'
        );

        const packageJson = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8'));
        expect(packageJson.name).toBe('my-api');
        expect(packageJson.scripts.build).toBe('tsc');

        expect(readFileSync(join(target, '.env.example'), 'utf8')).toContain('PORT=3000');
        expect(readFileSync(join(target, '.gitignore'), 'utf8')).toContain('/pgdata');
    });

    it('the plan touches nothing until commit is called', async () => {
        const target = scratch();
        const plan = await generate(
            { ...spec(), targetDir: target },
            {
                source: source(),
                atarashiVersion: '1.0.0',
            }
        );

        expect(plan.ok).toBe(true);
        expect(readdirSync(target)).toEqual([]);
    });

    it('regenerating from the written atarashi.json reproduces the same files', async () => {
        const deps = {
            source: source(),
            atarashiVersion: '1.0.0',
            now: () => new Date('2026-09-07T00:00:00.000Z'),
        };

        const first = await generate(spec(), deps);
        if (!first.ok) throw first.error;

        const config = JSON.parse(
            String(first.value.files.find((file) => file.path === 'atarashi.json')!.contents)
        );

        const second = await generate(
            {
                specVersion: config.specVersion,
                name: config.name,
                blueprints: config.blueprints.map((entry: { id: string }) => ({
                    id: entry.id,
                    reason: 'user' as const,
                })),
                answers: config.answers,
                options: config.options,
            } as ProjectSpec,
            deps
        );
        if (!second.ok) throw second.error;

        expect(second.value.files.map((f) => [f.path, String(f.contents)])).toEqual(
            first.value.files.map((f) => [f.path, String(f.contents)])
        );
    });

    it('runs post-actions against the written project', async () => {
        const plan = await generate(spec(), { source: source(), atarashiVersion: '1.0.0' });
        if (!plan.ok) throw plan.error;

        const target = join(scratch(), 'my-api');
        commit(plan.value, target);

        const calls: string[] = [];
        const exec: Executor = async (command, args) => {
            calls.push(`${command} ${args.join(' ')}`);
            return command === 'git' && args[0] === 'rev-parse'
                ? { code: 128, output: '' }
                : { code: 0, output: '' };
        };

        const result = await runActions(plan.value, spec(), { targetDir: target, exec });

        expect(calls).toContain('git init -b main');
        expect(calls).toContain('pnpm install');
        expect(calls).toContain('git commit -m chore: scaffold with atarashi');
        expect(result.outcomes.every((outcome) => outcome.ok)).toBe(true);
    });

    it('refuses to overwrite an existing project, then explains how', async () => {
        const plan = await generate(spec(), { source: source(), atarashiVersion: '1.0.0' });
        if (!plan.ok) throw plan.error;

        const target = join(scratch(), 'my-api');
        expect(commit(plan.value, target).ok).toBe(true);

        const second = commit(plan.value, target);
        expect(second.ok).toBe(false);
        if (second.ok) return;
        expect(second.error.diagnostics[0]?.suggestions?.[0]).toContain('atarashi add');

        expect(commit(plan.value, target, { force: true }).ok).toBe(true);
    });
});
