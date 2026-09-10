import { describe, expect, it } from 'vitest';
import { formatDiff, lineDiff } from '../src/diff.js';

describe('lineDiff', () => {
    it('reports no changes for identical text', () => {
        const lines = lineDiff('a\nb\nc', 'a\nb\nc');
        expect(lines?.every((line) => line.type === 'context')).toBe(true);
    });

    it('marks an inserted line as add and nothing else as changed', () => {
        const lines = lineDiff('a\nb\nc', 'a\nb\nnew\nc');
        expect(lines).toBeDefined();
        expect(lines!.filter((line) => line.type === 'add')).toEqual([
            { type: 'add', text: 'new' },
        ]);
        expect(lines!.filter((line) => line.type === 'remove')).toEqual([]);
    });

    it('marks a removed line as remove', () => {
        const lines = lineDiff('a\nb\nc', 'a\nc');
        expect(lines!.filter((line) => line.type === 'remove')).toEqual([
            { type: 'remove', text: 'b' },
        ]);
    });
});

describe('formatDiff', () => {
    it('prefixes +/- for changed lines and collapses distant context', () => {
        const lines = lineDiff(
            Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n'),
            [
                ...Array.from({ length: 10 }, (_, i) => `line${i}`),
                'inserted',
                ...Array.from({ length: 9 }, (_, i) => `line${i + 10}`),
            ].join('\n')
        )!;
        const rendered = formatDiff(lines, 1);
        expect(rendered).toContain('+ inserted');
        expect(rendered).toContain('…');
    });
});
