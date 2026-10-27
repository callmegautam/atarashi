import { formatDiff, lineDiff } from './diff.js';
import type { Printer } from './output.js';
import { isWrite, type Reconciled } from './reconcile.js';

const ICONS: Record<Reconciled['kind'], string> = {
    create: '+',
    update: '·',
    merge: '~',
    delete: '-',
    unchanged: ' ',
    skip: ' ',
    conflict: '!',
};

const text = (value: string | Buffer | undefined): string | undefined =>
    typeof value === 'string' ? value : undefined;

/**
 * The reviewable form of a reconcile: every write, with `diff` its lines, and
 * every conflict with the change it could not apply. Conflicts always show
 * that change, because once `atarashi.json` moves on nothing reproduces it.
 */
export function printChanges(printer: Printer, changes: Reconciled[], diff: boolean): void {
    for (const change of changes.filter(isWrite)) {
        printer.line(`  ${ICONS[change.kind]} ${change.path} (${change.kind})`);
        if (!diff || change.kind === 'delete') continue;
        const from = change.kind === 'create' ? '' : text(change.from);
        const to = text(change.contents);
        if (from === undefined || to === undefined) continue;
        const lines = lineDiff(from, to);
        if (lines) printer.line(formatDiff(lines));
    }
    for (const change of changes.filter((candidate) => candidate.kind === 'skip')) {
        printer.line(`    ${change.path}: ${change.note}`);
    }
    for (const change of changes.filter((candidate) => candidate.kind === 'conflict')) {
        printer.warn(`${change.path}: ${change.note}; left untouched`);
        const from = text(change.from);
        const to = text(change.to);
        if (from === undefined || to === undefined) continue;
        const lines = lineDiff(from, to);
        if (lines) {
            printer.line('    the change it would have made:');
            printer.line(formatDiff(lines));
        }
    }
}

export const summarizeChanges = (changes: Reconciled[]) =>
    changes
        .filter((change) => change.kind !== 'unchanged')
        .map(({ path, kind, note }) => (note ? { path, kind, note } : { path, kind }));
