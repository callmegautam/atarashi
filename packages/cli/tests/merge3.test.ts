import { describe, expect, it } from 'vitest';
import { mergeJson, mergeLines, mergeText } from '../src/merge3.js';

const lines = (...values: string[]) => values.join('\n');

describe('mergeLines', () => {
    it('takes whichever side changed when the other did not', () => {
        const base = lines('a', 'b', 'c');
        const changed = lines('a', 'B', 'c');
        expect(mergeLines(base, base, changed)).toEqual({ ok: true, contents: changed });
        expect(mergeLines(base, changed, base)).toEqual({ ok: true, contents: changed });
        expect(mergeLines(base, changed, changed)).toEqual({ ok: true, contents: changed });
    });

    it('combines edits to separate parts of a file', () => {
        const base = lines('import a', '', 'one', 'two', 'three', '', 'export x');
        const ours = lines('import a', '', 'one', 'two', 'three', '', 'export x', 'export mine');
        const theirs = lines('import a', 'import b', '', 'one', 'two', 'three', '', 'export x');

        expect(mergeLines(base, ours, theirs)).toEqual({
            ok: true,
            contents: lines(
                'import a',
                'import b',
                '',
                'one',
                'two',
                'three',
                '',
                'export x',
                'export mine'
            ),
        });
    });

    it('carries a deletion across an unrelated edit', () => {
        const base = lines('keep', 'drop me', 'keep too', 'tail');
        const ours = lines('keep', 'drop me', 'keep too', 'tail', 'added by hand');
        const theirs = lines('keep', 'keep too', 'tail');

        expect(mergeLines(base, ours, theirs)).toEqual({
            ok: true,
            contents: lines('keep', 'keep too', 'tail', 'added by hand'),
        });
    });

    it('refuses overlapping edits instead of picking a side', () => {
        const base = lines('a', 'b', 'c');
        expect(mergeLines(base, lines('a', 'mine', 'c'), lines('a', 'theirs', 'c'))).toEqual({
            ok: false,
        });
    });

    it('refuses rather than build an oversized table', () => {
        const big = Array.from({ length: 4100 }, (_, index) => `line ${index}`);
        const ours = [...big];
        ours[10] = 'mine';
        const theirs = [...big].reverse();
        expect(mergeLines(big.join('\n'), ours.join('\n'), theirs.join('\n'))).toEqual({
            ok: false,
        });
    });
});

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`;

describe('mergeJson', () => {
    it('removes a generated dependency while keeping one added by hand', () => {
        const base = json({ name: 'app', dependencies: { express: '^5', jsonwebtoken: '^9' } });
        const ours = json({
            name: 'app',
            dependencies: { express: '^5', jsonwebtoken: '^9', lodash: '^4' },
        });
        const theirs = json({ name: 'app', dependencies: { express: '^5' } });

        const result = mergeJson(base, ours, theirs);
        expect(result).toEqual({
            ok: true,
            contents: json({ name: 'app', dependencies: { express: '^5', lodash: '^4' } }),
        });
    });

    it('keeps sorted maps sorted when a key arrives', () => {
        const base = json({ dependencies: { a: '1', z: '1' } });
        const ours = json({ dependencies: { a: '1', b: '1', z: '1' } });
        const theirs = json({ dependencies: { a: '1', m: '1', z: '1' } });

        const result = mergeJson(base, ours, theirs);
        expect(result.ok && Object.keys(JSON.parse(result.contents).dependencies)).toEqual([
            'a',
            'b',
            'm',
            'z',
        ]);
    });

    it('keeps the order of unsorted objects and appends new keys', () => {
        const base = json({ scripts: { dev: 'x', build: 'y' } });
        const ours = json({ scripts: { dev: 'x', build: 'y', mine: 'z' } });
        const theirs = json({ scripts: { dev: 'x', build: 'y', test: 'v' } });

        const result = mergeJson(base, ours, theirs);
        expect(result.ok && Object.keys(JSON.parse(result.contents).scripts)).toEqual([
            'dev',
            'build',
            'mine',
            'test',
        ]);
    });

    it('conflicts when both sides set the same key differently', () => {
        const base = json({ dependencies: { express: '^4' } });
        expect(
            mergeJson(
                base,
                json({ dependencies: { express: '^4.21' } }),
                json({ dependencies: { express: '^5' } })
            )
        ).toEqual({ ok: false });
    });

    it('preserves the on-disk indentation', () => {
        const base = JSON.stringify({ a: 1 }, null, 4);
        const ours = JSON.stringify({ a: 1, mine: true }, null, 4);
        const theirs = JSON.stringify({ a: 2 }, null, 4);
        expect(mergeJson(base, ours, theirs)).toEqual({
            ok: true,
            contents: JSON.stringify({ a: 2, mine: true }, null, 4),
        });
    });

    it('returns the disk copy byte for byte when nothing needs to move', () => {
        const base = json({ a: 1 });
        const ours = '{ "a": 1, "b": 2 }\n';
        expect(mergeJson(base, ours, base)).toEqual({ ok: true, contents: ours });
    });

    it('declines anything that does not parse', () => {
        expect(mergeJson('{', '{}', '{}')).toEqual({ ok: false });
    });
});

describe('mergeText', () => {
    it('falls back to a line merge when a JSON file is not valid JSON', () => {
        const base = lines('{', '  // comment', '  "a": 1', '}');
        const ours = lines('{', '  // comment', '  "a": 1', '}', '');
        const theirs = lines('{', '  // changed', '  "a": 1', '}');
        expect(mergeText('tsconfig.json', base, ours, theirs)).toEqual({
            ok: true,
            contents: lines('{', '  // changed', '  "a": 1', '}', ''),
        });
    });

    it('merges other files by line', () => {
        expect(mergeText('src/app.ts', 'a\nb', 'a\nb\nc', 'z\na\nb')).toEqual({
            ok: true,
            contents: 'z\na\nb\nc',
        });
    });
});
