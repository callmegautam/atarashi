import {
    type Conflict,
    DIAGNOSTIC_CODES,
    type Diagnostic,
    error,
    FORBIDDEN_SCRIPTS,
    type JsonValue,
    type MergeStrategy,
    warning,
} from '@atarashi/schema';
import YAML from 'yaml';
import type { FileFragment, SlotContribution } from '../render/renderer.js';
import { injectSlots } from '../render/slots.js';
import { VirtualFileSystem } from '../write/vfs.js';
import { deepMerge, sortKeys, stableStringify } from './json.js';
import { mergePackageJson } from './package-json.js';
import { concatenate, mergeEnv, mergeLinesUnique, parseEnv } from './text.js';

export interface MergeResult {
    files: VirtualFileSystem;
    conflicts: Conflict[];
    diagnostics: Diagnostic[];
}

const asText = (contents: string | Buffer): string =>
    typeof contents === 'string' ? contents : contents.toString('utf8');

const parseJson = (contents: string, path: string, source: string): JsonValue => {
    try {
        return JSON.parse(contents) as JsonValue;
    } catch (error) {
        throw new Error(`${source} produced invalid JSON for ${path}: ${(error as Error).message}`);
    }
};

const isPackageJson = (path: string): boolean =>
    path === 'package.json' || path.endsWith('/package.json');

/**
 * Doc 09 § T3. An install script is the one thing in a generated project that
 * runs without the user asking for it, which makes it what a malicious
 * blueprint would reach for — and reach for through whichever route is open: a
 * manifest `scripts` map, a `json-deep` contribution, or a `package.json` it
 * renders from a template. Every one of those becomes a fragment, so refusing
 * it here covers all three at once, with exact attribution to the blueprint
 * that tried.
 *
 * Trust is the line rather than the script name: `orm/prisma` wanting
 * `postinstall: prisma generate` is a reviewed, first-party blueprint the user
 * chose, and the plan shows it before anything installs.
 */
function refuseUntrustedInstallScripts(
    fragments: FileFragment[],
    untrusted: ReadonlySet<string>
): Diagnostic[] {
    if (untrusted.size === 0) return [];
    const diagnostics: Diagnostic[] = [];

    for (const fragment of fragments) {
        if (!isPackageJson(fragment.path) || !untrusted.has(fragment.source)) continue;

        let scripts: Record<string, unknown>;
        try {
            const parsed = JSON.parse(asText(fragment.contents)) as {
                scripts?: Record<string, unknown>;
            };
            scripts = parsed.scripts ?? {};
        } catch {
            // Reported as invalid generated JSON further down the pipeline.
            continue;
        }

        for (const name of Object.keys(scripts)) {
            if (!(FORBIDDEN_SCRIPTS as readonly string[]).includes(name)) continue;
            diagnostics.push(
                error(
                    DIAGNOSTIC_CODES.SCHEMA_INVALID,
                    `\`${fragment.source}\` is not trusted and tried to add the \`${name}\` script, which runs automatically on install`,
                    {
                        path: fragment.path,
                        blueprints: [fragment.source],
                        suggestions: [
                            'Remove the blueprint, or vendor it into `./.atarashi/blueprints` after reading what it does',
                            'A blueprint should use a named script and a `nextSteps` line instead',
                        ],
                    }
                )
            );
        }
    }

    return diagnostics;
}

/**
 * Reduces every fragment written to one path into a single file, using the
 * strategy declared for that path. Fragments arrive in graph order; every
 * strategy is order-dependent, so this is where determinism is earned.
 */
export function merge(
    fragments: FileFragment[],
    slots: SlotContribution[] = [],
    /**
     * Blueprint ids the registry did not mark trusted — anything from npm or a
     * third-party registry. Empty when every blueprint is first-party, local or
     * bundled.
     */
    untrusted: ReadonlySet<string> = new Set()
): MergeResult {
    const conflicts: Conflict[] = [];
    const diagnostics: Diagnostic[] = [];
    const files = new VirtualFileSystem();

    diagnostics.push(...refuseUntrustedInstallScripts(fragments, untrusted));

    const byPath = new Map<string, FileFragment[]>();
    for (const fragment of fragments) {
        byPath.set(fragment.path, [...(byPath.get(fragment.path) ?? []), fragment]);
    }

    const paths = [...byPath.keys()].sort();

    for (const path of paths) {
        const group = byPath
            .get(path)!
            .slice()
            .sort((a, b) => a.order - b.order || (a.source < b.source ? -1 : 1));

        const collision = files.caseCollision(path);
        if (collision) {
            conflicts.push({
                kind: 'file',
                subject: path,
                blueprints: [...new Set(group.map((fragment) => fragment.source))],
                message: `\`${path}\` and \`${collision}\` differ only by case and cannot coexist on macOS or Windows`,
                suggestions: ['Rename one of the two files in its blueprint'],
            });
            continue;
        }

        const merged = mergeGroup(path, group, conflicts, diagnostics);
        if (merged === undefined) continue;

        files.set(path, merged, {
            mode: group.reduce((mode, fragment) => Math.max(mode, fragment.mode), 0),
            sources: [...new Set(group.map((fragment) => fragment.source))],
        });
    }

    // Slots are injected after merging, so a contribution lands in the final
    // file even when several blueprints contributed to the base template.
    const bySlotTarget = new Map<string, SlotContribution[]>();
    for (const contribution of slots) {
        bySlotTarget.set(contribution.target, [
            ...(bySlotTarget.get(contribution.target) ?? []),
            contribution,
        ]);
    }

    for (const [target, contributions] of [...bySlotTarget.entries()].sort()) {
        const file = files.get(target);
        if (!file || file.binary) {
            diagnostics.push(
                warning(
                    DIAGNOSTIC_CODES.UNDECLARED_SLOT,
                    `${[...new Set(contributions.map((c) => c.source))].join(', ')} contributed to \`${target}\`, which no blueprint generates`,
                    { path: target, blueprints: [...new Set(contributions.map((c) => c.source))] }
                )
            );
            continue;
        }

        const grouped = new Map<string, string[]>();
        for (const contribution of [...contributions].sort(
            (a, b) => a.order - b.order || (a.source < b.source ? -1 : 1)
        )) {
            grouped.set(contribution.slot, [
                ...(grouped.get(contribution.slot) ?? []),
                contribution.value,
            ]);
        }

        const injected = injectSlots(asText(file.contents), grouped);
        files.set(target, injected.contents, { mode: file.mode, sources: file.sources });

        for (const slot of injected.missing) {
            const sources = contributions
                .filter((contribution) => contribution.slot === slot)
                .map((contribution) => contribution.source);
            diagnostics.push(
                warning(
                    DIAGNOSTIC_CODES.UNDECLARED_SLOT,
                    `\`${target}\` declares no \`${slot}\` slot; ${[...new Set(sources)].join(', ')} contributed to it anyway`,
                    { path: target, blueprints: [...new Set(sources)] }
                )
            );
        }
    }

    return { files, conflicts, diagnostics };
}

function mergeGroup(
    path: string,
    group: FileFragment[],
    conflicts: Conflict[],
    diagnostics: Diagnostic[]
): string | Buffer | undefined {
    const first = group[0]!;
    if (group.length === 1) return first.contents;

    const strategy: MergeStrategy = group.reduce<MergeStrategy>(
        (chosen, fragment) => (fragment.merge === 'error' ? chosen : fragment.merge),
        first.merge
    );
    const sources = [...new Set(group.map((fragment) => fragment.source))];

    if (group.some((fragment) => Buffer.isBuffer(fragment.contents))) {
        conflicts.push({
            kind: 'file',
            subject: path,
            blueprints: sources,
            message: `${sources.join(' and ')} both write the binary file \`${path}\``,
            suggestions: ['Only one blueprint can own a binary file'],
        });
        return undefined;
    }

    try {
        switch (strategy) {
            case 'error':
                conflicts.push({
                    kind: 'file',
                    subject: path,
                    blueprints: sources,
                    message: `${sources.join(' and ')} both write \`${path}\`, and neither declares a merge strategy`,
                    suggestions: [
                        `Declare a \`merge\` strategy for \`${path}\` in one of them`,
                        'Or have one blueprint contribute into a slot the other declares',
                    ],
                });
                return undefined;

            case 'overwrite': {
                const winner = group.at(-1)!;
                for (const loser of group.slice(0, -1)) {
                    diagnostics.push(
                        warning(
                            DIAGNOSTIC_CODES.OVERWRITTEN_FILE,
                            `${winner.source} overwrote \`${path}\` from ${loser.source}`,
                            { path, blueprints: [winner.source, loser.source] }
                        )
                    );
                }
                return winner.contents;
            }

            case 'json-deep': {
                if (path === 'package.json' || path.endsWith('/package.json')) {
                    const result = mergePackageJson(
                        group.map((fragment) => ({
                            value: parseJson(
                                asText(fragment.contents),
                                path,
                                fragment.source
                            ) as Record<string, JsonValue>,
                            source: fragment.source,
                        }))
                    );
                    conflicts.push(...result.conflicts);
                    return `${JSON.stringify(result.value, null, 2)}\n`;
                }

                const merged = group
                    .map((fragment) => parseJson(asText(fragment.contents), path, fragment.source))
                    .reduce((base, incoming) => deepMerge(base, incoming));
                return `${JSON.stringify(sortKeys(merged), null, 2)}\n`;
            }

            case 'yaml-deep': {
                const merged = group
                    .map((fragment) => (YAML.parse(asText(fragment.contents)) ?? {}) as JsonValue)
                    .reduce((base, incoming) => deepMerge(base, incoming));
                return YAML.stringify(merged, { lineWidth: 0 });
            }

            case 'env': {
                const result = mergeEnv(
                    group.flatMap((fragment) =>
                        parseEnv(asText(fragment.contents), fragment.source)
                    )
                );
                conflicts.push(...result.conflicts);
                return result.contents;
            }

            case 'lines-unique':
                return mergeLinesUnique(
                    group.map((fragment) => ({
                        contents: asText(fragment.contents),
                        source: fragment.source,
                    }))
                );

            case 'append':
            case 'prepend':
                return concatenate(
                    group.map((fragment) => ({
                        contents: asText(fragment.contents),
                        source: fragment.source,
                    })),
                    strategy
                );

            case 'ts-slots': {
                // The base file is whichever fragment actually declares slots;
                // the rest become contributions to it.
                const base = group.find((fragment) =>
                    asText(fragment.contents).includes('#region atarashi:')
                );
                if (!base) {
                    conflicts.push({
                        kind: 'file',
                        subject: path,
                        blueprints: sources,
                        message: `\`${path}\` uses the ts-slots strategy but no fragment declares a slot region`,
                        suggestions: ['Add `{{> slot "imports" }}` to the base template'],
                    });
                    return undefined;
                }
                return asText(base.contents);
            }

            default:
                return first.contents;
        }
    } catch (caught) {
        conflicts.push({
            kind: 'file',
            subject: path,
            blueprints: sources,
            message: (caught as Error).message,
            suggestions: [],
        });
        return undefined;
    }
}

export { stableStringify };
