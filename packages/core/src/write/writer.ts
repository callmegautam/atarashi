import { randomBytes } from 'node:crypto';
import {
    closeSync,
    existsSync,
    fsyncSync,
    lstatSync,
    mkdirSync,
    openSync,
    renameSync,
    rmSync,
    writeFileSync,
} from 'node:fs';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import {
    DIAGNOSTIC_CODES,
    type Diagnostic,
    error,
    fail,
    type GenerationPlan,
    ok,
    type Result,
} from '@atarashi/schema';
import { normalizeProjectPath, PathSafetyError } from './paths.js';
import { preflight } from './preflight.js';

export interface WriteOptions {
    force?: boolean;
    /** Skip the preflight check — the caller has already made the decision. */
    skipPreflight?: boolean;
}

export interface WriteReport {
    targetDir: string;
    filesWritten: string[];
    /** Pre-existing files this write replaced. Only possible under `--force`. */
    filesReplaced: string[];
    diagnostics: Diagnostic[];
}

const pathEscape = (path: string, sources: string[], detail: string) =>
    fail<WriteReport>(DIAGNOSTIC_CODES.PATH_ESCAPE, `Refusing to write \`${path}\`: ${detail}`, [
        error(DIAGNOSTIC_CODES.PATH_ESCAPE, detail, { path, blueprints: sources }),
    ]);

interface Move {
    from: string;
    to: string;
    /** Where the file that used to live at `to` was parked, if any. */
    backup?: string;
}

/**
 * Writes a plan to disk atomically.
 *
 * Every file is written into a temp directory inside the target (so the final
 * move never crosses a filesystem boundary), fsync'd, then renamed into place
 * one at a time. If anything fails — including a Ctrl-C — every completed move
 * is undone and the temp directory is removed. The user's disk is never left
 * half-written.
 */
/**
 * Doc 09 § T1. Both `mkdir -p` and `rename` follow a symlinked directory, so a
 * `src -> /etc` planted in the target would redirect `src/passwd` outside it —
 * the path checks above only reason about the string, which looks harmless.
 * Walking the real components is the only way to see it.
 *
 * This matters most for `atarashi add`, which runs inside a repository the user
 * may have cloned from somewhere they do not control.
 */
function assertNoSymlinkedParent(root: string, relative: string): void {
    const segments = relative.split('/');
    let current = root;

    for (const segment of segments.slice(0, -1)) {
        current = join(current, segment);
        let stats: ReturnType<typeof lstatSync>;
        try {
            stats = lstatSync(current);
        } catch {
            // Does not exist yet, so there is nothing to follow.
            return;
        }
        if (stats.isSymbolicLink()) {
            throw new PathSafetyError(
                `\`${relative}\` passes through \`${segment}\`, which is a symlink`,
                relative
            );
        }
    }
}

export function commit(
    plan: GenerationPlan,
    targetDir: string,
    options: WriteOptions = {}
): Result<WriteReport> {
    if (plan.conflicts.length > 0) {
        return fail(
            DIAGNOSTIC_CODES.MERGE_CONFLICT,
            'Refusing to write a plan with unresolved conflicts',
            plan.conflicts.map((conflict) =>
                error(DIAGNOSTIC_CODES.MERGE_CONFLICT, conflict.message, {
                    blueprints: conflict.blueprints,
                    suggestions: conflict.suggestions,
                })
            )
        );
    }

    const root = resolvePath(targetDir);

    if (!options.skipPreflight) {
        const checked = preflight(root, { force: options.force ?? false });
        if (!checked.ok) return checked;
    }

    // Confirm once more, against the resolved absolute path, that no file can
    // land outside the target. The plan is trusted less than the target: it may
    // have been assembled by a hook, a caller, or an older version of the CLI.
    for (const file of plan.files) {
        let destination: string;
        try {
            destination = resolvePath(root, normalizeProjectPath(file.path));
        } catch (caught) {
            return pathEscape(file.path, file.sources, (caught as Error).message);
        }
        if (destination !== root && !destination.startsWith(root + sep)) {
            return pathEscape(
                file.path,
                file.sources,
                `\`${file.path}\` would be written outside \`${root}\``
            );
        }
    }

    const createdRoot = !existsSync(root);
    // Recursive, unlike v0.6's `mkdirSync`, which threw on a nested target.
    mkdirSync(root, { recursive: true });

    const temp = join(root, `.atarashi-tmp-${randomBytes(6).toString('hex')}`);
    mkdirSync(temp, { recursive: true });

    const moves: Move[] = [];
    let interrupted = false;
    const onInterrupt = () => {
        interrupted = true;
    };
    process.on('SIGINT', onInterrupt);
    process.on('SIGTERM', onInterrupt);

    const rollback = () => {
        // Reverse order, so a file restored from backup is not immediately
        // clobbered by undoing an earlier move.
        for (const move of [...moves].reverse()) {
            try {
                rmSync(move.to, { force: true });
                if (move.backup) renameSync(move.backup, move.to);
            } catch {
                // Best effort: a failed restore must not mask the original error.
            }
        }
        rmSync(temp, { recursive: true, force: true });
        if (createdRoot) rmSync(root, { recursive: true, force: true });
    };

    try {
        // Stage everything first: a failure here has touched nothing real.
        const staged = plan.files.map((file) => {
            const relative = normalizeProjectPath(file.path);
            const stagedPath = join(temp, relative);

            mkdirSync(dirname(stagedPath), { recursive: true });

            const contents = Buffer.isBuffer(file.contents)
                ? file.contents
                : // LF everywhere; `.gitattributes` handles Windows checkouts.
                  Buffer.from(file.contents.replace(/\r\n/g, '\n'), 'utf8');

            writeFileSync(stagedPath, contents, { mode: file.mode, flag: 'wx' });

            const handle = openSync(stagedPath, 'r');
            try {
                fsyncSync(handle);
            } finally {
                closeSync(handle);
            }

            return { relative, stagedPath, destination: join(root, relative) };
        });

        if (interrupted) throw new Error('Interrupted');

        const replaced: string[] = [];

        for (const file of staged) {
            assertNoSymlinkedParent(root, file.relative);
            mkdirSync(dirname(file.destination), { recursive: true });

            const move: Move = { from: file.stagedPath, to: file.destination };

            if (existsSync(file.destination)) {
                move.backup = `${file.stagedPath}.replaced`;
                renameSync(file.destination, move.backup);
                replaced.push(file.relative);
            }

            renameSync(file.stagedPath, file.destination);
            moves.push(move);

            if (interrupted) throw new Error('Interrupted');
        }

        rmSync(temp, { recursive: true, force: true });

        return ok({
            targetDir: root,
            filesWritten: staged.map((file) => file.relative),
            filesReplaced: replaced,
            diagnostics: [],
        });
    } catch (caught) {
        rollback();
        const message = (caught as Error).message;
        const code = interrupted ? DIAGNOSTIC_CODES.INTERRUPTED : DIAGNOSTIC_CODES.WRITE_FAILED;
        return fail(
            code,
            interrupted
                ? 'Generation was interrupted; nothing was written'
                : `Failed to write the project: ${message}`,
            [
                error(code, interrupted ? 'Rolled back every file' : message, {
                    suggestions: ['The target directory was left exactly as it was'],
                }),
            ]
        );
    } finally {
        process.off('SIGINT', onInterrupt);
        process.off('SIGTERM', onInterrupt);
    }
}
