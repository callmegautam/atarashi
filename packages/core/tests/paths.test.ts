import { describe, expect, it } from 'vitest';
import {
    caseKey,
    normalizeProjectPath,
    PathSafetyError,
    resolveDotfileNames,
} from '../src/write/paths.js';
import { VirtualFileSystem } from '../src/write/vfs.js';

describe('path safety', () => {
    it.each([
        ['/etc/passwd', 'absolute'],
        ['C:/Windows/system32', 'a drive path'],
        ['C:\\Windows\\system32', 'a backslash drive path'],
        ['../outside.ts', 'traversal'],
        ['src/../../outside.ts', 'traversal after normalization'],
        ['..', 'the parent directory'],
        ['~/.ssh/id_rsa', 'a home-relative path'],
        ['src/\0evil.ts', 'a null byte'],
        ['', 'empty'],
        ['.', 'the project root'],
        ['./', 'the project root with a slash'],
        ['src/aux.ts', 'a Windows reserved name'],
        ['src/CON', 'a Windows reserved name in caps'],
        ['src/a:b.ts', 'a Windows-illegal character'],
        ['src/what?.ts', 'a question mark'],
        ['src/trailing /x', 'a segment ending in a space'],
        ['src/dot./x', 'a segment ending in a dot'],
    ])('rejects %j (%s)', (path) => {
        expect(() => normalizeProjectPath(path)).toThrow(PathSafetyError);
    });

    it.each([
        ['src/index.ts', 'src/index.ts'],
        ['./src/index.ts', 'src/index.ts'],
        ['src\\db\\index.ts', 'src/db/index.ts'],
        ['src//db///index.ts', 'src/db/index.ts'],
        ['src/db/../index.ts', 'src/index.ts'],
        ['.github/workflows/ci.yml', '.github/workflows/ci.yml'],
        ['src/', 'src'],
    ])('normalizes %j to %j', (input, expected) => {
        expect(normalizeProjectPath(input)).toBe(expected);
    });

    it('names the offending path on the error', () => {
        try {
            normalizeProjectPath('../escape');
            expect.unreachable();
        } catch (error) {
            expect((error as PathSafetyError).path).toBe('../escape');
            expect((error as PathSafetyError).message).toContain('escapes the target directory');
        }
    });
});

describe('dotfile convention', () => {
    it.each([
        ['_gitignore', '.gitignore'],
        ['_env.example', '.env.example'],
        ['_github/workflows/ci.yml', '.github/workflows/ci.yml'],
        ['src/index.ts', 'src/index.ts'],
        ['_', '_'],
    ])('resolves %j to %j', (input, expected) => {
        expect(resolveDotfileNames(input)).toBe(expected);
    });
});

describe('virtual filesystem', () => {
    it('stores, reads and lists files in a stable order', () => {
        const vfs = new VirtualFileSystem();
        vfs.set('src/index.ts', 'export {};');
        vfs.set('package.json', '{}');
        vfs.set('src/db/client.ts', 'export {};');

        expect(vfs.paths()).toEqual(['package.json', 'src/db/client.ts', 'src/index.ts']);
        expect(vfs.readText('src/index.ts')).toBe('export {};');
        expect(vfs.size).toBe(3);
    });

    it('normalizes paths on the way in', () => {
        const vfs = new VirtualFileSystem();
        vfs.set('./src\\index.ts', 'x');
        expect(vfs.has('src/index.ts')).toBe(true);
        expect(vfs.paths()).toEqual(['src/index.ts']);
    });

    it('detects case collisions before they reach a case-insensitive disk', () => {
        const vfs = new VirtualFileSystem();
        vfs.set('README.md', '# a');
        expect(vfs.caseCollision('readme.md')).toBe('README.md');
        expect(vfs.caseCollision('README.md')).toBeUndefined();
        expect(vfs.caseCollision('CHANGELOG.md')).toBeUndefined();
        expect(caseKey('README.md')).toBe('readme.md');
    });

    it('tracks binary files without stringifying them', () => {
        const vfs = new VirtualFileSystem();
        const bytes = Buffer.from([0x00, 0x01, 0x02]);
        const file = vfs.set('public/favicon.ico', bytes);
        expect(file.binary).toBe(true);
        expect(vfs.get('public/favicon.ico')?.contents).toBe(bytes);
    });

    it('defaults to 0644 and accepts an explicit mode', () => {
        const vfs = new VirtualFileSystem();
        expect(vfs.set('a.txt', 'a').mode).toBe(0o644);
        expect(vfs.set('run.sh', '#!/bin/sh', { mode: 0o755 }).mode).toBe(0o755);
    });

    it('builds a tree for previews', () => {
        const vfs = new VirtualFileSystem();
        vfs.set('src/index.ts', 'x');
        vfs.set('src/db/client.ts', 'x');
        vfs.set('package.json', '{}');

        expect(vfs.tree()).toEqual({
            'package.json': null,
            src: { 'index.ts': null, db: { 'client.ts': null } },
        });
    });

    it('counts bytes across text and binary files', () => {
        const vfs = new VirtualFileSystem();
        vfs.set('a.txt', 'abc');
        vfs.set('b.bin', Buffer.alloc(5));
        expect(vfs.totalBytes()).toBe(8);
    });

    it('clones without sharing file objects', () => {
        const vfs = new VirtualFileSystem();
        vfs.set('a.txt', 'a');
        const clone = vfs.clone();
        clone.set('a.txt', 'b');
        expect(vfs.readText('a.txt')).toBe('a');
        expect(clone.readText('a.txt')).toBe('b');
    });

    it('deletes and frees the case slot', () => {
        const vfs = new VirtualFileSystem();
        vfs.set('README.md', 'a');
        expect(vfs.delete('README.md')).toBe(true);
        expect(vfs.caseCollision('readme.md')).toBeUndefined();
        expect(vfs.delete('README.md')).toBe(false);
    });
});
