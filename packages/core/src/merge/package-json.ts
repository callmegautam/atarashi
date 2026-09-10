import type { Conflict, JsonValue } from '@atarashi/schema';
import semver from 'semver';
import { deepMerge, isPlainObject } from './json.js';

/**
 * A fixed key order so generated `package.json` files are byte-identical run to
 * run and readable top to bottom. Anything not listed keeps insertion order
 * after these.
 */
export const PACKAGE_JSON_KEY_ORDER = [
    'name',
    'version',
    'private',
    'description',
    'keywords',
    'homepage',
    'bugs',
    'repository',
    'license',
    'author',
    'contributors',
    'type',
    'main',
    'module',
    'types',
    'exports',
    'bin',
    'files',
    'engines',
    'packageManager',
    'scripts',
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
    'overrides',
    'resolutions',
] as const;

const DEPENDENCY_FIELDS = [
    'dependencies',
    'devDependencies',
    'peerDependencies',
    'optionalDependencies',
] as const;

/**
 * Narrows two ranges to the one that satisfies both. `null` means they cannot
 * both be satisfied — a real conflict the user has to resolve, reported with
 * both blueprint names.
 */
export function intersectRanges(a: string, b: string): string | null {
    if (a === b) return a;
    if (a === '*' || a === 'latest') return b;
    if (b === '*' || b === 'latest') return a;

    const left = semver.validRange(a);
    const right = semver.validRange(b);
    // A workspace:/file:/git: specifier is not a semver range; prefer it as-is
    // rather than pretending we can reason about it.
    if (!left || !right) return left ? a : right ? b : null;

    if (!semver.intersects(a, b, { includePrerelease: true })) return null;
    if (semver.subset(a, b, { includePrerelease: true })) return a;
    if (semver.subset(b, a, { includePrerelease: true })) return b;
    return `${a} ${b}`;
}

export interface PackageJsonMergeResult {
    value: Record<string, JsonValue>;
    conflicts: Conflict[];
}

/**
 * The single most important merge in the system. Dependencies union by name
 * with range intersection; scripts union by key and conflict on disagreement;
 * everything else falls back to a deep merge.
 */
export function mergePackageJson(
    fragments: { value: Record<string, JsonValue>; source: string }[]
): PackageJsonMergeResult {
    const conflicts: Conflict[] = [];
    const result: Record<string, JsonValue> = {};

    const rangeOwners = new Map<string, { range: string; source: string }>();
    const scriptOwners = new Map<string, { value: string; source: string }>();

    for (const fragment of fragments) {
        for (const [key, value] of Object.entries(fragment.value)) {
            if ((DEPENDENCY_FIELDS as readonly string[]).includes(key) && isPlainObject(value)) {
                result[key] ??= {};
                const bucket = result[key] as Record<string, JsonValue>;

                for (const [name, range] of Object.entries(value)) {
                    const incoming = String(range);
                    const key_ = `${key}:${name}`;
                    const existing = rangeOwners.get(key_);

                    if (!existing) {
                        rangeOwners.set(key_, { range: incoming, source: fragment.source });
                        bucket[name] = incoming;
                        continue;
                    }

                    const intersection = intersectRanges(existing.range, incoming);
                    if (intersection === null) {
                        conflicts.push({
                            kind: 'dependency-range',
                            subject: name,
                            blueprints: [existing.source, fragment.source].sort(),
                            message: `${existing.source} wants ${name}@${existing.range} but ${fragment.source} wants ${name}@${incoming}`,
                            suggestions: [
                                `Pin ${name} yourself after generating, or drop one of the two blueprints`,
                            ],
                        });
                        continue;
                    }

                    rangeOwners.set(key_, { range: intersection, source: existing.source });
                    bucket[name] = intersection;
                }
                continue;
            }

            if (key === 'scripts' && isPlainObject(value)) {
                result.scripts ??= {};
                const bucket = result.scripts as Record<string, JsonValue>;

                for (const [name, script] of Object.entries(value)) {
                    const incoming = String(script);
                    const existing = scriptOwners.get(name);

                    if (existing && existing.value !== incoming) {
                        conflicts.push({
                            kind: 'script',
                            subject: name,
                            blueprints: [existing.source, fragment.source].sort(),
                            message: `${existing.source} and ${fragment.source} both define the \`${name}\` script with different commands`,
                            suggestions: [`Keep one of: \`${existing.value}\` or \`${incoming}\``],
                        });
                        continue;
                    }

                    scriptOwners.set(name, { value: incoming, source: fragment.source });
                    bucket[name] = incoming;
                }
                continue;
            }

            result[key] = key in result ? deepMerge(result[key]!, value) : value;
        }
    }

    return { value: orderPackageJson(result), conflicts };
}

/** Applies the fixed key order, sorting dependency and script maps by name. */
export function orderPackageJson(value: Record<string, JsonValue>): Record<string, JsonValue> {
    const ordered: Record<string, JsonValue> = {};
    const remaining = new Set(Object.keys(value));

    const put = (key: string) => {
        if (!remaining.has(key)) return;
        remaining.delete(key);

        const entry = value[key]!;
        const sortable =
            (DEPENDENCY_FIELDS as readonly string[]).includes(key) || key === 'scripts';

        ordered[key] = sortable && isPlainObject(entry) ? sortObject(entry) : entry;
    };

    for (const key of PACKAGE_JSON_KEY_ORDER) put(key);
    for (const key of [...remaining].sort()) put(key);

    return ordered;
}

const sortObject = (value: Record<string, JsonValue>): Record<string, JsonValue> =>
    Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : 1)));
