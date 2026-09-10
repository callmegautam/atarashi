import { existsSync } from 'node:fs';
import { readdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { RegistryError } from '../src/errors.js';
import { extractTarball, readTarball, safeEntryPath } from '../src/extract.js';
import { makeTar, tempDir } from './helpers.js';

/**
 * Security boundary (doc 09, T1). Every case here is a hard failure, never a
 * skipped entry — a malicious archive must not extract "the safe parts".
 */
describe('T4 — safeEntryPath (security boundary)', () => {
    it('accepts ordinary relative paths', () => {
        expect(safeEntryPath('blueprint.json')).toBe('blueprint.json');
        expect(safeEntryPath('./files/src/index.ts')).toBe('files/src/index.ts');
    });

    it('strips leading components when asked', () => {
        expect(safeEntryPath('package/blueprint.json', 1)).toBe('blueprint.json');
        expect(safeEntryPath('package', 1)).toBeUndefined();
    });

    it.each([
        ['../escape', 'escapes'],
        ['a/../../escape', 'escapes'],
        ['/etc/passwd', 'absolute'],
        ['C:/Windows/system32', 'drive'],
        ['//host/share/file', 'UNC'],
        ['bad\0name', 'null byte'],
    ])('rejects %s', (path, reason) => {
        expect(() => safeEntryPath(path)).toThrow(new RegExp(reason, 'i'));
    });
});

describe('T4 — readTarball limits (security boundary)', () => {
    it('reads files and normalizes modes to 644 or 755', async () => {
        const files = await readTarball(
            makeTar([
                { name: 'blueprint.json', contents: '{}' },
                { name: 'files/bin/run.sh', contents: '#!/bin/sh\n', mode: 0o755 },
            ])
        );

        expect(files.map((file) => file.path)).toEqual(['blueprint.json', 'files/bin/run.sh']);
        expect(files[0]!.mode).toBe(0o644);
        expect(files[1]!.mode).toBe(0o755);
        expect(files[0]!.contents.toString()).toBe('{}');
    });

    it('accepts gzipped archives', async () => {
        const files = await readTarball(gzipSync(makeTar([{ name: 'a.txt', contents: 'hi' }])));
        expect(files[0]!.contents.toString()).toBe('hi');
    });

    it('ignores directory members', async () => {
        const files = await readTarball(
            makeTar([
                { name: 'files/', type: '5' },
                { name: 'files/a.txt', contents: 'a' },
            ])
        );
        expect(files).toHaveLength(1);
    });

    it('refuses symlinks and hard links', async () => {
        await expect(
            readTarball(makeTar([{ name: 'evil', type: '2', linkname: '/etc/passwd' }]))
        ).rejects.toThrow(/is a link/);
        await expect(
            readTarball(makeTar([{ name: 'evil', type: '1', linkname: 'blueprint.json' }]))
        ).rejects.toThrow(/is a link/);
    });

    it('refuses a traversing member even when other members are fine', async () => {
        await expect(
            readTarball(
                makeTar([
                    { name: 'blueprint.json', contents: '{}' },
                    { name: '../../.ssh/authorized_keys', contents: 'ssh-rsa AAA' },
                ])
            )
        ).rejects.toThrow(/escapes/);
    });

    it('refuses two members that collide case-insensitively', async () => {
        await expect(
            readTarball(
                makeTar([
                    { name: 'README.md', contents: 'a' },
                    { name: 'readme.md', contents: 'b' },
                ])
            )
        ).rejects.toThrow(/collide|twice/);
    });

    it('enforces the entry-count limit', async () => {
        const entries = Array.from({ length: 5 }, (_, index) => ({
            name: `f${index}.txt`,
            contents: 'x',
        }));
        await expect(readTarball(makeTar(entries), { limits: { maxEntries: 3 } })).rejects.toThrow(
            /more than 3 members/
        );
    });

    it('enforces the per-file limit from the declared size, before reading it', async () => {
        await expect(
            readTarball(makeTar([{ name: 'big.bin', contents: 'x'.repeat(2048) }]), {
                limits: { maxFileSize: 512 },
            })
        ).rejects.toThrow(/larger than the 512 byte limit/);
    });

    it('enforces the uncompressed total, so a zip bomb cannot be inflated', async () => {
        const bomb = gzipSync(Buffer.alloc(1024 * 64, 0));
        await expect(readTarball(bomb, { limits: { maxTotalSize: 1024 } })).rejects.toThrow(
            /decompressed|size limit/
        );
    });

    it('rejects an archive with no files at all', async () => {
        await expect(readTarball(makeTar([]))).rejects.toThrow(RegistryError);
    });
});

describe('T4 — extractTarball (security boundary)', () => {
    it('writes every member under the destination', async () => {
        const dest = join(await tempDir(), 'out');
        const written = await extractTarball(
            makeTar([
                { name: 'blueprint.json', contents: '{"id":"db/postgres"}' },
                { name: 'files/src/index.ts', contents: 'export {};\n' },
            ]),
            dest
        );

        expect(written).toEqual(['blueprint.json', 'files/src/index.ts']);
        expect(await readFile(join(dest, 'files/src/index.ts'), 'utf8')).toBe('export {};\n');
    });

    it('writes nothing when any member is unsafe', async () => {
        const root = await tempDir();
        const dest = join(root, 'out');

        await expect(
            extractTarball(
                makeTar([
                    { name: 'blueprint.json', contents: '{}' },
                    { name: '../owned.txt', contents: 'pwned' },
                ]),
                dest
            )
        ).rejects.toThrow(/escapes/);

        expect(existsSync(dest)).toBe(false);
        expect(await readdir(root)).toEqual([]);
    });

    it('does not follow a symlink planted at a target path', async () => {
        const root = await tempDir();
        const dest = join(root, 'out');
        const outside = join(root, 'outside.txt');

        await writeFile(outside, 'original');
        await extractTarball(makeTar([{ name: 'keep.txt', contents: 'x' }]), dest);
        await symlink(outside, join(dest, 'target.txt'));

        await expect(
            extractTarball(makeTar([{ name: 'target.txt', contents: 'overwritten' }]), dest)
        ).rejects.toThrow();
        expect(await readFile(outside, 'utf8')).toBe('original');
    });
});
