import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
    DIAGNOSTIC_CODES,
    type Diagnostic,
    type GenerationPlan,
    type PostAction,
    type PostActionKind,
    type ProjectSpec,
    warning,
} from '@atarashi/schema';

export interface ActionOutcome {
    kind: PostActionKind;
    ok: boolean;
    skipped: boolean;
    message?: string;
    durationMs: number;
}

export interface ActionRunnerOptions {
    targetDir: string;
    /** Streamed to the caller line by line; the CLI decides whether to show it. */
    onOutput?: (chunk: string) => void;
    /** Injected in tests so nothing actually shells out. */
    exec?: Executor;
    timeoutMs?: number;
}

export type Executor = (
    command: string,
    args: string[],
    options: { cwd: string; timeoutMs: number; onOutput?: (chunk: string) => void }
) => Promise<{ code: number; output: string }>;

export const spawnExecutor: Executor = (command, args, options) =>
    new Promise((resolveExec) => {
        const child = spawn(command, args, {
            cwd: options.cwd,
            // Never a shell: arguments are passed as an array so nothing in a
            // blueprint-derived string can be interpreted as shell syntax.
            shell: false,
            stdio: ['ignore', 'pipe', 'pipe'],
            timeout: options.timeoutMs,
        });

        let output = '';
        const capture = (chunk: Buffer) => {
            const text = chunk.toString('utf8');
            output += text;
            options.onOutput?.(text);
        };

        child.stdout?.on('data', capture);
        child.stderr?.on('data', capture);

        child.on('error', (err) => resolveExec({ code: -1, output: `${output}${err.message}` }));
        child.on('close', (code) => resolveExec({ code: code ?? -1, output }));
    });

/** `git rev-parse` is the only reliable answer; a parent directory may be a repo. */
async function insideGitRepo(targetDir: string, exec: Executor): Promise<boolean> {
    const result = await exec('git', ['rev-parse', '--is-inside-work-tree'], {
        cwd: targetDir,
        timeoutMs: 5_000,
    });
    return result.code === 0 && result.output.trim() === 'true';
}

/**
 * Runs the plan's post-actions in order.
 *
 * No action is ever fatal to the generation: a failed `pnpm install` leaves a
 * perfectly valid project on disk, and the caller is told exactly how to retry.
 * That is why this returns outcomes and diagnostics rather than a `Result`.
 */
export async function runActions(
    plan: GenerationPlan,
    spec: ProjectSpec,
    options: ActionRunnerOptions
): Promise<{ outcomes: ActionOutcome[]; diagnostics: Diagnostic[] }> {
    const exec = options.exec ?? spawnExecutor;
    const timeoutMs = options.timeoutMs ?? 10 * 60 * 1000;
    const outcomes: ActionOutcome[] = [];
    const diagnostics: Diagnostic[] = [];

    const record = async (
        action: PostAction,
        run: () => Promise<{ ok: boolean; message?: string }>
    ) => {
        const started = Date.now();

        if (action.skipped) {
            outcomes.push({
                kind: action.kind,
                ok: true,
                skipped: true,
                ...(action.skipReason ? { message: `skipped (${action.skipReason})` } : {}),
                durationMs: 0,
            });
            return;
        }

        const result = await run();
        outcomes.push({
            kind: action.kind,
            ok: result.ok,
            skipped: false,
            ...(result.message ? { message: result.message } : {}),
            durationMs: Date.now() - started,
        });
    };

    const invoke = async (command: string, args: string[], retry: string) => {
        const result = await exec(command, args, {
            cwd: options.targetDir,
            timeoutMs,
            ...(options.onOutput ? { onOutput: options.onOutput } : {}),
        });

        if (result.code === 0) return { ok: true };

        diagnostics.push(
            warning(
                DIAGNOSTIC_CODES.ACTION_FAILED,
                `\`${command} ${args.join(' ')}\` exited with code ${result.code}`,
                {
                    suggestions: [`Your project is fine — run \`${retry}\` in it to retry`],
                    detail: result.output.trim().slice(-2000),
                }
            )
        );
        return { ok: false, message: `exited with ${result.code}` };
    };

    for (const action of plan.actions) {
        switch (action.kind) {
            case 'git-init':
                await record(action, async () => {
                    if (await insideGitRepo(options.targetDir, exec)) {
                        return { ok: true, message: 'already inside a git repository' };
                    }
                    return invoke('git', action.args, 'git init');
                });
                break;

            case 'install':
                await record(action, () =>
                    invoke(action.command!, action.args, `${action.command} install`)
                );
                break;

            case 'format':
                await record(action, async () => {
                    // Use the formatter the generated project itself ships, not
                    // one Atarashi imposes on it.
                    const formatter = detectFormatter(options.targetDir, plan);
                    if (!formatter) return { ok: true, message: 'no formatter in this project' };
                    if (!spec.options.install) {
                        return { ok: true, message: 'skipped: dependencies are not installed' };
                    }
                    return invoke(formatter.command, formatter.args, formatter.retry);
                });
                break;

            case 'git-commit':
                await record(action, async () => {
                    const staged = await invoke('git', ['add', '-A'], 'git add -A');
                    if (!staged.ok) return staged;
                    return invoke('git', action.args, 'git commit');
                });
                break;

            default:
                await record(action, async () => ({ ok: true }));
        }
    }

    return { outcomes, diagnostics };
}

/** Picks whichever formatter the generated project declares, if any. */
function detectFormatter(
    targetDir: string,
    plan: GenerationPlan
): { command: string; args: string[]; retry: string } | undefined {
    const has = (path: string) =>
        plan.files.some((file) => file.path === path) || existsSync(join(targetDir, path));

    if (has('biome.json') || has('biome.jsonc')) {
        return {
            command: 'npx',
            args: ['biome', 'format', '--write', '.'],
            retry: 'npx biome format --write .',
        };
    }
    if (has('.prettierrc') || has('.prettierrc.json') || has('prettier.config.js')) {
        return {
            command: 'npx',
            args: ['prettier', '--write', '.'],
            retry: 'npx prettier --write .',
        };
    }
    return undefined;
}
