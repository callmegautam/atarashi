import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';

const cli = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'cli.js');
const dirs: string[] = [];

afterEach(() => {
    while (dirs.length > 0) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const run = (bin: string): string =>
    execFileSync(process.execPath, [bin, '--version'], { encoding: 'utf8' }).trim();

/**
 * `npm install -g` and `npm link` both put a *symlink* in the global bin.
 * Node then reports `import.meta.url` as the real file and leaves
 * `process.argv[1]` as the symlink, so an entry-point check that compares the
 * two as strings makes the installed CLI exit 0 having done nothing — which is
 * exactly how it shipped until someone ran `npm link`.
 */
describe.skipIf(!existsSync(cli))('the built binary', () => {
    it('runs when invoked directly', () => {
        expect(run(cli)).toMatch(/^\d+\.\d+\.\d+/);
    });

    it('runs when invoked through a symlink, as a global install does', () => {
        const dir = mkdtempSync(join(tmpdir(), 'atarashi-bin-'));
        dirs.push(dir);
        const link = join(dir, 'atarashi');
        symlinkSync(cli, link);

        expect(run(link)).toBe(run(cli));
    });
});
