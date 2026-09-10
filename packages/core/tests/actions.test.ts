import type { GenerationPlan, PostAction, ProjectSpec } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { type Executor, runActions } from '../src/actions/index.js';
import { specFor } from './source.js';

interface Call {
    command: string;
    args: string[];
}

const recorder = (
    responses: Record<string, { code: number; output: string }> = {}
): { exec: Executor; calls: Call[] } => {
    const calls: Call[] = [];
    const exec: Executor = async (command, args) => {
        calls.push({ command, args });
        const key = `${command} ${args.join(' ')}`;
        return responses[key] ?? { code: 0, output: '' };
    };
    return { exec, calls };
};

const action = (kind: PostAction['kind'], overrides: Partial<PostAction> = {}): PostAction => ({
    kind,
    label: kind,
    skipped: false,
    args: [],
    ...overrides,
});

const planOf = (actions: PostAction[], files: string[] = []): GenerationPlan => ({
    specVersion: 1,
    files: files.map((path) => ({ path, contents: '', mode: 0o644, sources: [], binary: false })),
    conflicts: [],
    actions,
    warnings: [],
    summary: {
        fileCount: files.length,
        totalBytes: 0,
        deps: { dependencies: [], devDependencies: [] },
        blueprints: [],
        nextSteps: [],
    },
});

const spec = specFor([]) as ProjectSpec;

describe('post-actions', () => {
    it('runs them in the order the plan lists', async () => {
        const { exec, calls } = recorder({
            'git rev-parse --is-inside-work-tree': { code: 128, output: '' },
        });

        await runActions(
            planOf([
                action('git-init', { command: 'git', args: ['init', '-b', 'main'] }),
                action('install', { command: 'pnpm', args: ['install'] }),
                action('git-commit', { command: 'git', args: ['commit', '-m', 'chore: scaffold'] }),
            ]),
            spec,
            { targetDir: '/tmp/project', exec }
        );

        expect(calls.map((call) => `${call.command} ${call.args[0]}`)).toEqual([
            'git rev-parse',
            'git init',
            'pnpm install',
            'git add',
            'git commit',
        ]);
    });

    it('reports a skipped action with the flag that skipped it', async () => {
        const { exec, calls } = recorder();
        const result = await runActions(
            planOf([action('install', { skipped: true, skipReason: '--no-install' })]),
            spec,
            { targetDir: '/tmp/project', exec }
        );

        expect(calls).toEqual([]);
        expect(result.outcomes[0]).toMatchObject({
            kind: 'install',
            skipped: true,
            ok: true,
            message: 'skipped (--no-install)',
        });
    });

    it('skips git init when the target is already inside a repository', async () => {
        const { exec, calls } = recorder({
            'git rev-parse --is-inside-work-tree': { code: 0, output: 'true\n' },
        });

        const result = await runActions(
            planOf([action('git-init', { command: 'git', args: ['init', '-b', 'main'] })]),
            spec,
            { targetDir: '/tmp/project', exec }
        );

        expect(calls.map((call) => call.args[0])).toEqual(['rev-parse']);
        expect(result.outcomes[0]?.message).toBe('already inside a git repository');
        expect(result.outcomes[0]?.ok).toBe(true);
    });

    it('never treats a failed install as fatal, and says how to retry', async () => {
        const { exec } = recorder({
            'pnpm install': { code: 1, output: 'ERR_PNPM_FETCH_404 not found' },
        });

        const result = await runActions(
            planOf([action('install', { command: 'pnpm', args: ['install'] })]),
            spec,
            { targetDir: '/tmp/project', exec }
        );

        expect(result.outcomes[0]).toMatchObject({ kind: 'install', ok: false, skipped: false });
        expect(result.diagnostics[0]?.severity).toBe('warning');
        expect(result.diagnostics[0]?.suggestions?.[0]).toContain('pnpm install');
        expect(result.diagnostics[0]?.detail).toContain('ERR_PNPM_FETCH_404');
    });

    it('keeps going after one action fails', async () => {
        const { exec } = recorder({ 'pnpm install': { code: 1, output: 'boom' } });

        const result = await runActions(
            planOf([
                action('install', { command: 'pnpm', args: ['install'] }),
                action('git-commit', { command: 'git', args: ['commit', '-m', 'x'] }),
            ]),
            spec,
            { targetDir: '/tmp/project', exec }
        );

        expect(result.outcomes.map((outcome) => outcome.ok)).toEqual([false, true]);
    });

    it('runs the formatter the generated project itself ships', async () => {
        const { exec, calls } = recorder();
        await runActions(planOf([action('format')], ['biome.json']), spec, {
            targetDir: '/tmp/project',
            exec,
        });
        expect(calls[0]).toMatchObject({
            command: 'npx',
            args: ['biome', 'format', '--write', '.'],
        });

        const prettier = recorder();
        await runActions(planOf([action('format')], ['.prettierrc']), spec, {
            targetDir: '/tmp/project',
            exec: prettier.exec,
        });
        expect(prettier.calls[0]?.args[0]).toBe('prettier');
    });

    it('does not format a project that ships no formatter', async () => {
        const { exec, calls } = recorder();
        const result = await runActions(planOf([action('format')], ['package.json']), spec, {
            targetDir: '/tmp/project',
            exec,
        });

        expect(calls).toEqual([]);
        expect(result.outcomes[0]?.message).toBe('no formatter in this project');
    });

    it('does not format when dependencies were never installed', async () => {
        const { exec, calls } = recorder();
        const result = await runActions(
            planOf([action('format')], ['biome.json']),
            { ...spec, options: { ...spec.options, install: false } },
            { targetDir: '/tmp/project', exec }
        );

        expect(calls).toEqual([]);
        expect(result.outcomes[0]?.message).toContain('dependencies are not installed');
    });

    it('stages everything before committing', async () => {
        const { exec, calls } = recorder();
        await runActions(
            planOf([action('git-commit', { command: 'git', args: ['commit', '-m', 'chore: x'] })]),
            spec,
            { targetDir: '/tmp/project', exec }
        );

        expect(calls.map((call) => call.args.join(' '))).toEqual(['add -A', 'commit -m chore: x']);
    });

    it('does not commit when staging fails', async () => {
        const { exec, calls } = recorder({ 'git add -A': { code: 1, output: 'nope' } });
        const result = await runActions(
            planOf([action('git-commit', { command: 'git', args: ['commit', '-m', 'x'] })]),
            spec,
            { targetDir: '/tmp/project', exec }
        );

        expect(calls.map((call) => call.args[0])).toEqual(['add']);
        expect(result.outcomes[0]?.ok).toBe(false);
    });

    it('streams output to the caller', async () => {
        const chunks: string[] = [];
        const exec: Executor = async (_command, _args, options) => {
            options.onOutput?.('installing...\n');
            return { code: 0, output: 'installing...\n' };
        };

        await runActions(
            planOf([action('install', { command: 'pnpm', args: ['install'] })]),
            spec,
            { targetDir: '/tmp/project', exec, onOutput: (chunk) => chunks.push(chunk) }
        );

        expect(chunks).toEqual(['installing...\n']);
    });

    it('times every action so the CLI can report how long install took', async () => {
        const { exec } = recorder();
        const result = await runActions(
            planOf([action('install', { command: 'pnpm', args: ['install'] })]),
            spec,
            { targetDir: '/tmp/project', exec }
        );
        expect(result.outcomes[0]?.durationMs).toBeGreaterThanOrEqual(0);
    });
});
