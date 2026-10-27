import type { PlannedFile } from '@atarashi/schema';
import { mergeText } from './merge3.js';

export type ReconcileKind =
    | 'create'
    | 'update'
    | 'merge'
    | 'delete'
    | 'unchanged'
    | 'skip'
    | 'conflict';

export interface Reconciled {
    path: string;
    kind: ReconcileKind;
    /** What gets written, for `create`, `update` and `merge`. */
    contents?: string | Buffer;
    mode?: number;
    /** The base and the new render, so a skipped change can still be reviewed. */
    from?: string | Buffer;
    to?: string | Buffer;
    note?: string;
}

export interface ReconcileInput {
    /** What the project was generated from: the render `atarashi.json` describes. */
    base: PlannedFile[];
    /** What it should become. */
    target: PlannedFile[];
    /** The file as it is on disk now, or `undefined` when it is not there. */
    read(path: string): Buffer | undefined;
    /**
     * Blueprints whose recorded version could not be reproduced. A file they
     * contributed to has no trustworthy base, so it is only ever left alone.
     */
    unverified?: ReadonlySet<string>;
}

const asBuffer = (value: string | Buffer): Buffer =>
    Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
const same = (a: string | Buffer, b: string | Buffer): boolean => asBuffer(a).equals(asBuffer(b));

/**
 * Three inputs per path: the base render, the target render and the disk.
 * Whatever the base and the disk agree on is untouched since generation and
 * safe to replace; whatever they disagree on was edited by hand, and only
 * changes when a three-way merge can carry the edit across. Nothing that
 * differs from the base is ever overwritten or deleted outright.
 */
export function reconcile(input: ReconcileInput): Reconciled[] {
    const base = new Map(input.base.map((file) => [file.path, file]));
    const target = new Map(input.target.map((file) => [file.path, file]));
    const paths = [...new Set([...base.keys(), ...target.keys()])].sort();
    const changes: Reconciled[] = [];

    for (const path of paths) {
        const before = base.get(path);
        const after = target.get(path);
        const onDisk = input.read(path);
        const trusted =
            before !== undefined && !before.sources.some((source) => input.unverified?.has(source));

        if (!after) {
            if (onDisk === undefined) continue;
            if (trusted && same(onDisk, before!.contents)) {
                changes.push({ path, kind: 'delete', from: before!.contents });
            } else {
                changes.push({
                    path,
                    kind: 'conflict',
                    from: before!.contents,
                    note: 'no longer generated, but edited since generation; delete it yourself if it is unused',
                });
            }
            continue;
        }

        if (before && same(before.contents, after.contents)) {
            changes.push({ path, kind: 'unchanged' });
            continue;
        }

        if (onDisk === undefined) {
            if (before) {
                changes.push({
                    path,
                    kind: 'skip',
                    from: before.contents,
                    to: after.contents,
                    note: 'deleted locally; not recreated',
                });
            } else {
                changes.push({ path, kind: 'create', contents: after.contents, mode: after.mode });
            }
            continue;
        }

        if (same(onDisk, after.contents)) {
            changes.push({ path, kind: 'unchanged' });
            continue;
        }

        if (!before) {
            changes.push({
                path,
                kind: 'conflict',
                to: after.contents,
                note: 'a file already exists here',
            });
            continue;
        }

        if (trusted && same(onDisk, before.contents)) {
            changes.push({
                path,
                kind: 'update',
                contents: after.contents,
                mode: after.mode,
                from: before.contents,
                to: after.contents,
            });
            continue;
        }

        if (trusted && !before.binary && !after.binary) {
            const merged = mergeText(
                path,
                before.contents as string,
                onDisk.toString('utf8'),
                after.contents as string
            );
            if (merged.ok) {
                changes.push({
                    path,
                    kind: 'merge',
                    contents: merged.contents,
                    mode: after.mode,
                    from: onDisk.toString('utf8'),
                    to: merged.contents,
                });
                continue;
            }
        }

        changes.push({
            path,
            kind: 'conflict',
            from: before.contents,
            to: after.contents,
            note: trusted
                ? 'edited since generation, and the edits overlap the change'
                : 'cannot tell whether this was edited, because its original blueprint version is unavailable',
        });
    }

    return changes;
}

export const isWrite = (change: Reconciled): boolean =>
    change.kind === 'create' ||
    change.kind === 'update' ||
    change.kind === 'merge' ||
    change.kind === 'delete';
