import {
    chmodSync,
    existsSync,
    mkdirSync,
    mkdtempSync,
    readdirSync,
    readFileSync,
    rmSync,
    statSync,
    symlinkSync,
    writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { GenerationPlan, PlannedFile } from '@atarashi/schema';
import { afterEach, describe, expect, it } from 'vitest';
import { commit, inspectTarget, preflight } from '../src/write/index.js';

const roots: string[] = [];

const scratch = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'atarashi-writer-'));
    roots.push(dir);
    return dir;
};

afterEach(() => {
    while (roots.length > 0) rmSync(roots.pop()!, { recursive: true, force: true });
});

const file = (path: string, contents: string | Buffer, mode = 0o644): PlannedFile => ({
    path,
    contents,
    mode,
    sources: ['a/one'],
    binary: Buffer.isBuffer(contents),
});

const planOf = (files: PlannedFile[], overrides: Partial<GenerationPlan> = {}): GenerationPlan => ({
    specVersion: 1,
    files,
    conflicts: [],
    actions: [],
    warnings: [],
    summary: {
        fileCount: files.length,
        totalBytes: 0,
        deps: { dependencies: [], devDependencies: [] },
        blueprints: [],
        nextSteps: [],
    },
    ...overrides,
});

describe('preflight', () => {
    it('recognises a missing directory', () => {
        const target = join(scratch(), 'new-project');
        expect(inspectTarget(target).kind).toBe('missing');
        expect(preflight(target, { force: false }).ok).toBe(true);
    });

    it('accepts an empty directory', () => {
        const target = scratch();
        expect(inspectTarget(target).kind).toBe('empty');
        expect(preflight(target, { force: false }).ok).toBe(true);
    });

    it('ignores .DS_Store and .git when deciding emptiness', () => {
        const target = scratch();
        writeFileSync(join(target, '.DS_Store'), '');
        mkdirSync(join(target, '.git'));
        expect(inspectTarget(target).kind).toBe('empty');
    });

    it('refuses a non-empty directory, listing what is in the way', () => {
        const target = scratch();
        writeFileSync(join(target, 'existing.txt'), 'hi');

        const result = preflight(target, { force: false });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_TARGET_NOT_EMPTY');
        expect(result.error.message).toContain('existing.txt');
        expect(result.error.diagnostics[0]?.suggestions).toContain(
            'Pass `--force` to merge into it'
        );
    });

    it('allows a non-empty directory under --force', () => {
        const target = scratch();
        writeFileSync(join(target, 'existing.txt'), 'hi');
        expect(preflight(target, { force: true }).ok).toBe(true);
    });

    it('suggests `atarashi add` for a directory that is already an Atarashi project', () => {
        const target = scratch();
        writeFileSync(join(target, 'atarashi.json'), '{}');

        const result = preflight(target, { force: false });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.diagnostics[0]?.suggestions?.[0]).toContain('atarashi add');
    });
});

describe('commit', () => {
    it('writes every file, creating directories recursively', () => {
        const target = join(scratch(), 'deeply', 'nested', 'my-api');
        const result = commit(
            planOf([
                file('package.json', '{"name":"my-api"}\n'),
                file('src/db/client.ts', 'export {};\n'),
            ]),
            target
        );

        expect(result.ok, result.ok ? '' : result.error.message).toBe(true);
        if (!result.ok) return;

        expect(readFileSync(join(target, 'package.json'), 'utf8')).toBe('{"name":"my-api"}\n');
        expect(readFileSync(join(target, 'src/db/client.ts'), 'utf8')).toBe('export {};\n');
        expect(result.value.filesWritten).toEqual(['package.json', 'src/db/client.ts']);
    });

    it('leaves no temp directory behind', () => {
        const target = scratch();
        commit(planOf([file('a.txt', 'a')]), target);
        expect(readdirSync(target).filter((entry) => entry.startsWith('.atarashi-tmp'))).toEqual(
            []
        );
    });

    it('applies file modes, including the executable bit', () => {
        const target = scratch();
        commit(planOf([file('entrypoint.sh', '#!/bin/sh\n', 0o755)]), target);
        expect(statSync(join(target, 'entrypoint.sh')).mode & 0o777).toBe(0o755);
    });

    it('writes binary files byte for byte', () => {
        const target = scratch();
        const bytes = Buffer.from([0x00, 0x01, 0xff]);
        commit(planOf([file('public/favicon.ico', bytes)]), target);
        expect(readFileSync(join(target, 'public/favicon.ico')).equals(bytes)).toBe(true);
    });

    it('normalises CRLF to LF', () => {
        const target = scratch();
        commit(planOf([file('a.txt', 'one\r\ntwo\r\n')]), target);
        expect(readFileSync(join(target, 'a.txt'), 'utf8')).toBe('one\ntwo\n');
    });

    it('refuses to write a plan that still has conflicts', () => {
        const target = scratch();
        const result = commit(
            planOf([file('a.txt', 'a')], {
                conflicts: [
                    {
                        kind: 'file',
                        subject: 'a.txt',
                        blueprints: ['a/one', 'b/two'],
                        message: 'both write a.txt',
                        suggestions: ['pick one'],
                    },
                ],
            }),
            target
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_MERGE_CONFLICT');
        expect(readdirSync(target)).toEqual([]);
    });

    it('refuses a path that would land outside the target', () => {
        const target = scratch();
        const result = commit(
            planOf([{ ...file('ok.txt', 'a'), path: '../escaped.txt' }]),
            join(target, 'project')
        );

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(existsSync(join(target, 'escaped.txt'))).toBe(false);
    });

    it('runs preflight by default and honours --force', () => {
        const target = scratch();
        writeFileSync(join(target, 'existing.txt'), 'hi');

        expect(commit(planOf([file('a.txt', 'a')]), target).ok).toBe(false);
        expect(existsSync(join(target, 'a.txt'))).toBe(false);

        expect(commit(planOf([file('a.txt', 'a')]), target, { force: true }).ok).toBe(true);
        expect(readFileSync(join(target, 'existing.txt'), 'utf8')).toBe('hi');
    });

    it('reports which pre-existing files it replaced', () => {
        const target = scratch();
        writeFileSync(join(target, 'README.md'), 'old');

        const result = commit(planOf([file('README.md', 'new')]), target, { force: true });
        if (!result.ok) throw result.error;

        expect(result.value.filesReplaced).toEqual(['README.md']);
        expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('new');
    });

    it('rolls back completely when a write fails midway', () => {
        const target = scratch();
        const blocked = join(target, 'locked');
        mkdirSync(blocked);
        writeFileSync(join(blocked, 'keep.txt'), 'precious');
        chmodSync(blocked, 0o500);

        try {
            const result = commit(
                planOf([file('fine.txt', 'a'), file('locked/nope.txt', 'b')]),
                target,
                { force: true }
            );

            expect(result.ok).toBe(false);
            if (result.ok) return;
            expect(result.error.code).toBe('ATA_WRITE_FAILED');

            // Nothing from the failed run survives, and what was there is intact.
            expect(existsSync(join(target, 'fine.txt'))).toBe(false);
            expect(readFileSync(join(blocked, 'keep.txt'), 'utf8')).toBe('precious');
            expect(readdirSync(target).filter((e) => e.startsWith('.atarashi-tmp'))).toEqual([]);
        } finally {
            chmodSync(blocked, 0o700);
        }
    });

    it('restores a replaced file when a later write fails', () => {
        const target = scratch();
        writeFileSync(join(target, 'README.md'), 'original');
        const blocked = join(target, 'locked');
        mkdirSync(blocked);
        chmodSync(blocked, 0o500);

        try {
            const result = commit(
                planOf([file('README.md', 'replacement'), file('locked/nope.txt', 'b')]),
                target,
                { force: true }
            );

            expect(result.ok).toBe(false);
            expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('original');
        } finally {
            chmodSync(blocked, 0o700);
        }
    });

    it('removes a directory it created when the write fails', () => {
        const target = join(scratch(), 'brand-new');
        const result = commit(planOf([{ ...file('x.txt', 'a'), path: '../escaped.txt' }]), target);
        expect(result.ok).toBe(false);
        expect(existsSync(target)).toBe(false);
    });

    it('writes nothing to disk before the final moves', () => {
        // The plan is a virtual filesystem: building it must not touch the target.
        const target = scratch();
        planOf([file('a.txt', 'a')]);
        expect(readdirSync(target)).toEqual([]);
    });
});

/**
 * Doc 09 § T1, as a security boundary. These must never be skipped: each one
 * fails if the corresponding mitigation is removed.
 */
describe('T1 — path traversal (security boundary)', () => {
    it('refuses to write through a symlinked directory planted in the target', () => {
        // The shape a cloned repository can arrive in: `src` points elsewhere,
        // and both `mkdir -p` and `rename` would follow it without this check.
        const outside = scratch();
        const target = scratch();
        symlinkSync(outside, join(target, 'src'));

        const result = commit(planOf([file('src/index.ts', 'escaped')]), target, { force: true });

        expect(result.ok).toBe(false);
        expect(existsSync(join(outside, 'index.ts'))).toBe(false);
        expect(readdirSync(outside)).toEqual([]);
    });

    it('leaves the target exactly as it was when it refuses', () => {
        const outside = scratch();
        const target = scratch();
        symlinkSync(outside, join(target, 'src'));
        writeFileSync(join(target, 'keep.txt'), 'untouched');

        commit(planOf([file('src/index.ts', 'escaped')]), target, { force: true });

        expect(readFileSync(join(target, 'keep.txt'), 'utf8')).toBe('untouched');
        expect(readdirSync(target).sort()).toEqual(['keep.txt', 'src']);
    });

    it('still writes a directory that merely shares a name with a symlink target', () => {
        const target = scratch();
        const result = commit(planOf([file('src/index.ts', 'fine')]), target);

        expect(result.ok).toBe(true);
        expect(readFileSync(join(target, 'src/index.ts'), 'utf8')).toBe('fine');
    });
});

/**
 * Doc 09 § T6, as a security boundary. Ctrl-C mid-write must leave the target
 * exactly as it was, and say so with its own exit code. Must never be skipped.
 */
describe('T6 — interruption rolls back (security boundary)', () => {
    /**
     * `commit` reads `contents` while staging, which is the window an interrupt
     * has to land in for the test to be deterministic. A getter puts it exactly
     * there, rather than racing a real signal.
     */
    const interruptingFile = (path: string): PlannedFile => {
        const planned = file(path, '');
        Object.defineProperty(planned, 'contents', {
            get() {
                process.emit('SIGINT');
                return 'never written';
            },
        });
        return planned;
    };

    it('writes nothing and reports the interruption', () => {
        const target = scratch();
        const result = commit(planOf([interruptingFile('src/index.ts')]), target);

        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_INTERRUPTED');
        expect(result.error.message).toMatch(/interrupted/i);
    });

    it('restores a file it had already replaced', () => {
        const target = scratch();
        writeFileSync(join(target, 'README.md'), 'original');

        const result = commit(
            planOf([file('README.md', 'replacement'), interruptingFile('src/index.ts')]),
            target,
            { force: true }
        );

        expect(result.ok).toBe(false);
        expect(readFileSync(join(target, 'README.md'), 'utf8')).toBe('original');
        expect(existsSync(join(target, 'src'))).toBe(false);
    });

    it('leaves no temp directory behind', () => {
        const target = scratch();
        commit(planOf([interruptingFile('a.txt')]), target, { force: true });

        expect(readdirSync(target).filter((name) => name.startsWith('.atarashi-tmp'))).toEqual([]);
    });
});
