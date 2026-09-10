export interface DiffLine {
    type: 'context' | 'add' | 'remove';
    text: string;
}

const MAX_DIFF_LINES = 4000;

/** A small LCS line-diff — good enough for the blueprint-sized files Atarashi writes. */
export function lineDiff(oldText: string, newText: string): DiffLine[] | undefined {
    const a = oldText.split('\n');
    const b = newText.split('\n');
    if (a.length > MAX_DIFF_LINES || b.length > MAX_DIFF_LINES) return undefined;

    const n = a.length;
    const m = b.length;
    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            dp[i]![j] =
                a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
    }

    const result: DiffLine[] = [];
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[i] === b[j]) {
            result.push({ type: 'context', text: a[i]! });
            i += 1;
            j += 1;
        } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
            result.push({ type: 'remove', text: a[i]! });
            i += 1;
        } else {
            result.push({ type: 'add', text: b[j]! });
            j += 1;
        }
    }
    while (i < n) {
        result.push({ type: 'remove', text: a[i]! });
        i += 1;
    }
    while (j < m) {
        result.push({ type: 'add', text: b[j]! });
        j += 1;
    }
    return result;
}

/** Renders with `N` lines of context around each changed run, `diff`-style. */
export function formatDiff(lines: DiffLine[], context = 2): string {
    const out: string[] = [];
    let sinceChange = Number.POSITIVE_INFINITY;
    let pendingGap = false;

    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index]!;
        if (line.type !== 'context') {
            sinceChange = 0;
        } else {
            sinceChange += 1;
        }

        const upcomingChange = lines
            .slice(index, index + context + 1)
            .some((candidate) => candidate.type !== 'context');

        if (line.type === 'context' && sinceChange > context && !upcomingChange) {
            pendingGap = true;
            continue;
        }

        if (pendingGap) {
            out.push('  …');
            pendingGap = false;
        }

        const prefix = line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' ';
        out.push(`${prefix} ${line.text}`);
    }

    return out.join('\n');
}
