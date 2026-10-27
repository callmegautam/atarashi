import type { PlannedFile } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { isWrite, reconcile } from '../src/reconcile.js';

const file = (
    path: string,
    contents: string | Buffer,
    sources = ['core/node-ts']
): PlannedFile => ({
    path,
    contents,
    mode: 0o644,
    sources,
    binary: Buffer.isBuffer(contents),
});

const disk =
    (files: Record<string, string | Buffer>) =>
    (path: string): Buffer | undefined => {
        const value = files[path];
        if (value === undefined) return undefined;
        return Buffer.isBuffer(value) ? value : Buffer.from(value);
    };

const kinds = (changes: ReturnType<typeof reconcile>) =>
    Object.fromEntries(changes.map((change) => [change.path, change.kind]));

describe('reconcile', () => {
    it('leaves a file alone whenever the base and the target agree', () => {
        const changes = reconcile({
            base: [file('a.ts', 'same')],
            target: [file('a.ts', 'same')],
            read: disk({ 'a.ts': 'edited by hand' }),
        });
        expect(kinds(changes)).toEqual({ 'a.ts': 'unchanged' });
    });

    it('replaces an untouched file and creates a new one', () => {
        const changes = reconcile({
            base: [file('a.ts', 'old')],
            target: [file('a.ts', 'new'), file('b.ts', 'fresh')],
            read: disk({ 'a.ts': 'old' }),
        });
        expect(kinds(changes)).toEqual({ 'a.ts': 'update', 'b.ts': 'create' });
        expect(changes.find((change) => change.path === 'a.ts')?.contents).toBe('new');
    });

    it('merges an edited file when the edits do not overlap', () => {
        const changes = reconcile({
            base: [file('a.ts', 'one\ntwo\nthree')],
            target: [file('a.ts', 'zero\none\ntwo\nthree')],
            read: disk({ 'a.ts': 'one\ntwo\nthree\nfour' }),
        });
        expect(changes[0]).toMatchObject({
            kind: 'merge',
            contents: 'zero\none\ntwo\nthree\nfour',
        });
    });

    it('reports a conflict, with the change it skipped, when edits overlap', () => {
        const changes = reconcile({
            base: [file('a.ts', 'a\nb\nc')],
            target: [file('a.ts', 'a\ntheirs\nc')],
            read: disk({ 'a.ts': 'a\nmine\nc' }),
        });
        expect(changes[0]).toMatchObject({
            kind: 'conflict',
            from: 'a\nb\nc',
            to: 'a\ntheirs\nc',
        });
        expect(changes.filter(isWrite)).toEqual([]);
    });

    it('deletes a file that is no longer generated only if untouched', () => {
        const changes = reconcile({
            base: [file('gone.ts', 'x'), file('kept.ts', 'y'), file('absent.ts', 'z')],
            target: [],
            read: disk({ 'gone.ts': 'x', 'kept.ts': 'y plus edits' }),
        });
        expect(kinds(changes)).toEqual({ 'gone.ts': 'delete', 'kept.ts': 'conflict' });
    });

    it('does not recreate a file the user deleted', () => {
        const changes = reconcile({
            base: [file('a.ts', 'old')],
            target: [file('a.ts', 'new')],
            read: disk({}),
        });
        expect(changes[0]).toMatchObject({ kind: 'skip' });
    });

    it('never overwrites a file it did not generate', () => {
        const changes = reconcile({
            base: [],
            target: [file('a.ts', 'new')],
            read: disk({ 'a.ts': 'someone else' }),
        });
        expect(changes[0]).toMatchObject({ kind: 'conflict', note: 'a file already exists here' });
    });

    it('counts a disk copy that already matches the target as done', () => {
        const changes = reconcile({
            base: [file('a.ts', 'old')],
            target: [file('a.ts', 'new')],
            read: disk({ 'a.ts': 'new' }),
        });
        expect(kinds(changes)).toEqual({ 'a.ts': 'unchanged' });
    });

    it('treats binary files as replace-or-conflict', () => {
        const changes = reconcile({
            base: [file('logo.png', Buffer.from([1, 2]))],
            target: [file('logo.png', Buffer.from([3, 4]))],
            read: disk({ 'logo.png': Buffer.from([9]) }),
        });
        expect(kinds(changes)).toEqual({ 'logo.png': 'conflict' });
    });

    it('trusts no base that came from an unreproduced blueprint version', () => {
        const changes = reconcile({
            base: [file('a.ts', 'old', ['http/express']), file('gone.ts', 'x', ['http/express'])],
            target: [file('a.ts', 'new', ['http/express'])],
            read: disk({ 'a.ts': 'old', 'gone.ts': 'x' }),
            unverified: new Set(['http/express']),
        });
        expect(kinds(changes)).toEqual({ 'a.ts': 'conflict', 'gone.ts': 'conflict' });
    });
});
