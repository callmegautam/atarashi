import {
    DIAGNOSTIC_CODES,
    type Diagnostic,
    fail,
    ok,
    type ProjectSpec,
    type Result,
    warning,
} from '@atarashi/schema';
import semver from 'semver';
import type { BlueprintGraph, EngineDeps, GraphNode, LoadedBlueprint } from '../types.js';
import * as errors from './errors.js';

interface Pending {
    id: string;
    reason: 'user' | 'preset' | 'auto';
    requiredBy?: string;
}

/** Levenshtein distance, capped — only used to suggest "did you mean". */
function distance(a: string, b: string): number {
    const rows = a.length + 1;
    const cols = b.length + 1;
    let previous = Array.from({ length: cols }, (_, i) => i);

    for (let i = 1; i < rows; i += 1) {
        const current = [i];
        for (let j = 1; j < cols; j += 1) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            current[j] = Math.min(current[j - 1]! + 1, previous[j]! + 1, previous[j - 1]! + cost);
        }
        previous = current;
    }
    return previous[cols - 1]!;
}

async function suggestIds(id: string, deps: EngineDeps): Promise<string[]> {
    const namespace = id.split('/')[0] ?? '';
    const candidates = await deps.source.providersOf(namespace).catch(() => []);
    return candidates
        .map((candidate) => candidate.id)
        .filter((candidate) => distance(candidate, id) <= 3)
        .sort()
        .slice(0, 2);
}

/**
 * Turns a selection of blueprint ids into an ordered, validated graph.
 *
 * Auto-adding is deliberately conservative: a missing capability with exactly
 * one provider is added silently-but-reported; more than one is an error that
 * lists the candidates, because guessing which database a user wanted is worse
 * than asking.
 */
export async function resolve(
    spec: ProjectSpec,
    deps: EngineDeps
): Promise<Result<BlueprintGraph>> {
    const diagnostics: Diagnostic[] = [];
    const loaded = new Map<string, LoadedBlueprint>();
    const meta = new Map<string, Pending>();

    const queue: Pending[] = spec.blueprints.map((selected) => ({
        id: selected.id,
        reason: selected.reason,
        requiredBy: selected.requiredBy,
    }));

    // -- a. load everything selected, then b. expand `requires` transitively ---
    while (queue.length > 0) {
        const pending = queue.shift()!;
        if (loaded.has(pending.id)) continue;

        const blueprint = await deps.source.load(pending.id);
        if (!blueprint) {
            return fail(DIAGNOSTIC_CODES.UNKNOWN_BLUEPRINT, `Unknown blueprint \`${pending.id}\``, [
                errors.unknownBlueprint(pending.id, await suggestIds(pending.id, deps)),
            ]);
        }

        loaded.set(pending.id, blueprint);
        meta.set(pending.id, pending);

        if (blueprint.manifest.deprecated) {
            const replacement = blueprint.manifest.deprecated.use;
            diagnostics.push(
                warning(
                    DIAGNOSTIC_CODES.BLUEPRINT_DEPRECATED,
                    `${pending.id} is deprecated since ${blueprint.manifest.deprecated.since}`,
                    {
                        blueprints: [pending.id],
                        suggestions: replacement ? [`Use \`${replacement}\` instead`] : undefined,
                    }
                )
            );
        }
        if (blueprint.manifest.experimental) {
            diagnostics.push(
                warning(
                    DIAGNOSTIC_CODES.BLUEPRINT_EXPERIMENTAL,
                    `${pending.id} is experimental and may change without a major bump`,
                    { blueprints: [pending.id] }
                )
            );
        }

        const provided = new Set([...loaded.values()].flatMap((entry) => entry.manifest.provides));
        // Requirements are checked against everything loaded *and* queued, so a
        // capability satisfied later in the queue does not trigger an auto-add.
        for (const capability of blueprint.manifest.requires) {
            if (provided.has(capability)) continue;
            if (queue.some((item) => item.id === capability)) continue;

            const providers = (await deps.source.providersOf(capability)).filter(
                (candidate) => !candidate.deprecated
            );
            const alreadyQueued = providers.some((candidate) =>
                queue.some((item) => item.id === candidate.id)
            );
            if (alreadyQueued) continue;

            // Nothing provides it: fall through to the post-expansion check,
            // which can see the whole graph and name the blueprint that took
            // the slot instead of just reporting a missing token.
            if (providers.length === 0) continue;
            if (providers.length > 1) {
                return fail(
                    DIAGNOSTIC_CODES.AMBIGUOUS_REQUIREMENT,
                    `${pending.id} requires \`${capability}\`, and several blueprints provide it`,
                    [
                        errors.ambiguousRequirement(
                            pending.id,
                            capability,
                            providers.map((candidate) => candidate.id).sort()
                        ),
                        ...diagnostics,
                    ]
                );
            }

            const only = providers[0]!;
            queue.push({ id: only.id, reason: 'auto', requiredBy: pending.id });
            diagnostics.push({
                severity: 'info',
                code: DIAGNOSTIC_CODES.AUTO_ADDED,
                message: `+ ${only.id} (required by ${pending.id} → ${capability})`,
                blueprints: [only.id, pending.id],
            });
        }
    }

    const entries = [...loaded.values()];

    // -- c. conflicts ------------------------------------------------------
    const providersByToken = new Map<string, string[]>();
    for (const entry of entries) {
        for (const token of entry.manifest.provides) {
            providersByToken.set(token, [
                ...(providersByToken.get(token) ?? []),
                entry.manifest.id,
            ]);
        }
    }

    for (const entry of entries) {
        for (const token of entry.manifest.conflicts) {
            const claimants = (providersByToken.get(token) ?? []).slice().sort();
            if (claimants.length > 1) {
                const [first, second] = claimants as [string, string];
                return fail(
                    DIAGNOSTIC_CODES.CAPABILITY_CONFLICT,
                    `Cannot combine ${first} with ${second}`,
                    [
                        errors.capabilityConflict({ id: first, token }, { id: second }),
                        ...diagnostics,
                    ]
                );
            }
        }
    }

    // A requirement that is still unmet after expansion means some blueprint in
    // the graph took the slot — report the pair, not just the missing token.
    const providedTokens = new Set(providersByToken.keys());
    for (const entry of entries) {
        for (const capability of entry.manifest.requires) {
            if (providedTokens.has(capability)) continue;

            const domain = capability.split(':')[0]!;
            const holder = entries.find((candidate) =>
                candidate.manifest.provides.some((token) => token.split(':')[0] === domain)
            );

            const diagnostic = holder
                ? errors.requirementConflict(
                      { id: entry.manifest.id, requires: capability },
                      { id: holder.manifest.id, provides: holder.manifest.provides }
                  )
                : errors.unsatisfiedRequirement(entry.manifest.id, capability);

            return fail(DIAGNOSTIC_CODES.UNSATISFIED_REQUIREMENT, diagnostic.message, [
                diagnostic,
                ...diagnostics,
            ]);
        }
    }

    // -- d. engines --------------------------------------------------------
    for (const entry of entries) {
        const { atarashi: atarashiRange, node: nodeRange } = entry.manifest.engines;
        if (
            atarashiRange &&
            !semver.satisfies(deps.atarashiVersion, atarashiRange, { includePrerelease: true })
        ) {
            return fail(
                DIAGNOSTIC_CODES.ENGINE_INCOMPATIBLE,
                `${entry.manifest.id} is not compatible with Atarashi ${deps.atarashiVersion}`,
                [
                    errors.engineIncompatible(
                        entry.manifest.id,
                        'atarashi',
                        atarashiRange,
                        deps.atarashiVersion
                    ),
                    ...diagnostics,
                ]
            );
        }
        const nodeVersion = deps.nodeVersion ?? process.versions.node;
        if (nodeRange && !semver.satisfies(nodeVersion, nodeRange)) {
            diagnostics.push(
                warning(
                    DIAGNOSTIC_CODES.ENGINE_INCOMPATIBLE,
                    `${entry.manifest.id} expects node ${nodeRange}; this is ${nodeVersion}`,
                    { blueprints: [entry.manifest.id] }
                )
            );
        }
    }

    // -- e. topological sort ----------------------------------------------
    const sorted = topologicalSort(entries);
    if (!sorted.ok)
        return fail(sorted.error.code, sorted.error.message, [
            ...sorted.error.diagnostics,
            ...diagnostics,
        ]);

    // Prompt names are global; a collision would silently cross-wire two
    // blueprints' answers, so it fails here rather than at render time.
    const promptOwners = new Map<string, string>();
    for (const entry of sorted.value) {
        for (const prompt of entry.manifest.prompts) {
            const owner = promptOwners.get(prompt.name);
            if (owner) {
                return fail(
                    DIAGNOSTIC_CODES.PROMPT_NAME_COLLISION,
                    `Duplicate prompt name \`${prompt.name}\``,
                    [
                        errors.promptCollision(prompt.name, [owner, entry.manifest.id]),
                        ...diagnostics,
                    ]
                );
            }
            promptOwners.set(prompt.name, entry.manifest.id);
        }
    }

    const nodes: GraphNode[] = sorted.value.map((blueprint, index) => {
        const pending = meta.get(blueprint.manifest.id);
        const node: GraphNode = {
            blueprint,
            order: index,
            reason: pending?.reason ?? 'user',
        };
        if (pending?.requiredBy) node.requiredBy = pending.requiredBy;
        return node;
    });

    const capabilities = new Map<string, string[]>();
    for (const node of nodes) {
        for (const token of node.blueprint.manifest.provides) {
            capabilities.set(token, [
                ...(capabilities.get(token) ?? []),
                node.blueprint.manifest.id,
            ]);
        }
    }

    return ok(
        {
            nodes,
            capabilities,
            byId: new Map(nodes.map((node) => [node.blueprint.manifest.id, node])),
        },
        diagnostics
    );
}

/**
 * Kahn's algorithm over `after` edges, with ties broken by `priority` then id
 * so the order is total and identical on every machine.
 */
function topologicalSort(entries: LoadedBlueprint[]): Result<LoadedBlueprint[]> {
    const byId = new Map(entries.map((entry) => [entry.manifest.id, entry]));
    const indegree = new Map<string, number>();
    const edges = new Map<string, string[]>();

    for (const entry of entries) {
        indegree.set(entry.manifest.id, indegree.get(entry.manifest.id) ?? 0);
        // `after: [x]` means "run after x", so the edge points x → this.
        for (const predecessor of entry.manifest.after) {
            if (!byId.has(predecessor)) continue; // an absent `after` target is just a hint
            edges.set(predecessor, [...(edges.get(predecessor) ?? []), entry.manifest.id]);
            indegree.set(entry.manifest.id, (indegree.get(entry.manifest.id) ?? 0) + 1);
        }
    }

    const rank = (id: string) => {
        const manifest = byId.get(id)!.manifest;
        return { priority: manifest.priority, id };
    };
    const compare = (a: string, b: string) => {
        const left = rank(a);
        const right = rank(b);
        return left.priority - right.priority || (left.id < right.id ? -1 : 1);
    };

    const ready = [...indegree.entries()]
        .filter(([, degree]) => degree === 0)
        .map(([id]) => id)
        .sort(compare);

    const order: LoadedBlueprint[] = [];
    while (ready.length > 0) {
        const id = ready.shift()!;
        order.push(byId.get(id)!);

        for (const next of edges.get(id) ?? []) {
            const remaining = (indegree.get(next) ?? 0) - 1;
            indegree.set(next, remaining);
            if (remaining === 0) {
                ready.push(next);
                ready.sort(compare);
            }
        }
    }

    if (order.length !== entries.length) {
        const stuck = entries
            .map((entry) => entry.manifest.id)
            .filter((id) => !order.some((entry) => entry.manifest.id === id))
            .sort();
        return fail(DIAGNOSTIC_CODES.DEPENDENCY_CYCLE, `Ordering cycle: ${stuck.join(' → ')}`, [
            errors.dependencyCycle(findCycle(stuck, byId)),
        ]);
    }

    return ok(order);
}

/** Walks `after` edges from a stuck node to print the actual loop, not just the set. */
function findCycle(stuck: string[], byId: Map<string, LoadedBlueprint>): string[] {
    const start = stuck[0];
    if (!start) return stuck;

    const path: string[] = [];
    const seen = new Set<string>();
    let current: string | undefined = start;

    while (current && !seen.has(current)) {
        seen.add(current);
        path.push(current);
        current = byId
            .get(current)
            ?.manifest.after.find((id) => stuck.includes(id) && byId.has(id));
    }

    if (current) {
        // Trim the tail that leads into the loop but is not part of it.
        return path.slice(path.indexOf(current)).reverse();
    }
    return path;
}
