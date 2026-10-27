const MAX_MERGE_LINES = 4000;

export type MergeResult = { ok: true; contents: string } | { ok: false };

/**
 * Index pairs `[inA, inB]` of one longest common subsequence of two line
 * arrays, in order. `undefined` past the size the quadratic table can afford.
 */
function matchLines(a: string[], b: string[]): [number, number][] | undefined {
    let start = 0;
    while (start < a.length && start < b.length && a[start] === b[start]) start += 1;
    let endA = a.length;
    let endB = b.length;
    while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
        endA -= 1;
        endB -= 1;
    }

    const n = endA - start;
    const m = endB - start;
    if (n > MAX_MERGE_LINES || m > MAX_MERGE_LINES) return undefined;

    const dp: Uint32Array[] = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i -= 1) {
        for (let j = m - 1; j >= 0; j -= 1) {
            dp[i]![j] =
                a[start + i] === b[start + j]
                    ? dp[i + 1]![j + 1]! + 1
                    : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
        }
    }

    const pairs: [number, number][] = [];
    for (let i = 0; i < start; i += 1) pairs.push([i, i]);
    let i = 0;
    let j = 0;
    while (i < n && j < m) {
        if (a[start + i] === b[start + j]) {
            pairs.push([start + i, start + j]);
            i += 1;
            j += 1;
        } else if (dp[i + 1]![j]! >= dp[i]![j + 1]!) {
            i += 1;
        } else {
            j += 1;
        }
    }
    for (let k = 0; endA + k < a.length; k += 1) pairs.push([endA + k, endB + k]);
    return pairs;
}

const sameLines = (a: string[], b: string[]): boolean =>
    a.length === b.length && a.every((line, index) => line === b[index]);

/**
 * A diff3 line merge. Lines unchanged in both `ours` and `theirs` anchor the
 * merge; between anchors, a side that left the base alone takes the other
 * side's version. Both sides changing the same stretch differently is a
 * conflict, and a conflict merges nothing.
 */
export function mergeLines(base: string, ours: string, theirs: string): MergeResult {
    if (ours === theirs) return { ok: true, contents: ours };
    if (ours === base) return { ok: true, contents: theirs };
    if (theirs === base) return { ok: true, contents: ours };

    const o = base.split('\n');
    const a = ours.split('\n');
    const b = theirs.split('\n');
    const pairsA = matchLines(o, a);
    const pairsB = matchLines(o, b);
    if (!pairsA || !pairsB) return { ok: false };

    const inA = new Map(pairsA);
    const inB = new Map(pairsB);
    const out: string[] = [];
    let io = 0;
    let ia = 0;
    let ib = 0;

    const resolveChunk = (endO: number, endA: number, endB: number): boolean => {
        const chunkO = o.slice(io, endO);
        const chunkA = a.slice(ia, endA);
        const chunkB = b.slice(ib, endB);
        if (sameLines(chunkA, chunkO)) out.push(...chunkB);
        else if (sameLines(chunkB, chunkO) || sameLines(chunkA, chunkB)) out.push(...chunkA);
        else return false;
        return true;
    };

    for (let k = 0; k < o.length; k += 1) {
        const ka = inA.get(k);
        const kb = inB.get(k);
        if (ka === undefined || kb === undefined || ka < ia || kb < ib) continue;
        if (!resolveChunk(k, ka, kb)) return { ok: false };
        out.push(o[k]!);
        io = k + 1;
        ia = ka + 1;
        ib = kb + 1;
    }
    if (!resolveChunk(o.length, a.length, b.length)) return { ok: false };

    return { ok: true, contents: out.join('\n') };
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };

const isObject = (value: unknown): value is Record<string, Json> =>
    value !== null && typeof value === 'object' && !Array.isArray(value);

const MISSING = Symbol('missing');
type Slot = Json | typeof MISSING;

const equal = (a: Slot, b: Slot): boolean =>
    a === MISSING || b === MISSING ? a === b : JSON.stringify(a) === JSON.stringify(b);

const isSorted = (keys: string[]): boolean =>
    keys.every((key, index) => index === 0 || keys[index - 1]! <= key);

/** Key by key; arrays and scalars are atomic. `MISSING` in the result means "drop the key". */
function mergeValue(
    base: Slot,
    ours: Slot,
    theirs: Slot
): { ok: true; value: Slot } | { ok: false } {
    if (equal(ours, theirs)) return { ok: true, value: ours };
    if (equal(ours, base)) return { ok: true, value: theirs };
    if (equal(theirs, base)) return { ok: true, value: ours };
    if (!isObject(ours) || !isObject(theirs)) return { ok: false };

    const baseObject = isObject(base) ? base : {};
    const keys = Object.keys(ours);
    for (const key of Object.keys(theirs)) if (!keys.includes(key)) keys.push(key);

    const merged: Record<string, Json> = {};
    for (const key of keys) {
        const result = mergeValue(
            key in baseObject ? baseObject[key]! : MISSING,
            key in ours ? ours[key]! : MISSING,
            key in theirs ? theirs[key]! : MISSING
        );
        if (!result.ok) return result;
        if (result.value !== MISSING) merged[key] = result.value;
    }

    // Dependency maps are kept sorted by the generator; a merged key should
    // land where a package manager would put it, not at the end.
    const mergedKeys = Object.keys(merged);
    if (isSorted(Object.keys(ours)) && isSorted(Object.keys(theirs)) && !isSorted(mergedKeys)) {
        return {
            ok: true,
            value: Object.fromEntries(mergedKeys.sort().map((key) => [key, merged[key]!])),
        };
    }
    return { ok: true, value: merged };
}

function detectIndent(text: string): string | number {
    const match = /^[ \t]+(?=")/m.exec(text);
    if (!match) return 2;
    return match[0].startsWith('\t') ? '\t' : match[0].length;
}

/** A structural three-way merge, so two edits to different keys never collide. */
export function mergeJson(base: string, ours: string, theirs: string): MergeResult {
    let parsed: [Json, Json, Json];
    try {
        parsed = [JSON.parse(base), JSON.parse(ours), JSON.parse(theirs)];
    } catch {
        return { ok: false };
    }
    const result = mergeValue(...parsed);
    if (!result.ok || result.value === MISSING) return { ok: false };
    if (equal(result.value, parsed[1])) return { ok: true, contents: ours };

    const trailing = ours.endsWith('\n') ? '\n' : '';
    return {
        ok: true,
        contents: `${JSON.stringify(result.value, null, detectIndent(ours))}${trailing}`,
    };
}

/** JSON files merge structurally when all three sides parse; everything else by line. */
export function mergeText(path: string, base: string, ours: string, theirs: string): MergeResult {
    if (path.endsWith('.json')) {
        const structural = mergeJson(base, ours, theirs);
        if (structural.ok) return structural;
    }
    return mergeLines(base, ours, theirs);
}
