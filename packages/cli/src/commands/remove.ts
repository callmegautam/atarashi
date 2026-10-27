import type { LoadedBlueprint } from '@atarashi/core';
import { runActions } from '@atarashi/core';
import {
    AtarashiError,
    DIAGNOSTIC_CODES,
    type Diagnostic,
    error as errorDiagnostic,
    type ProjectSpec,
} from '@atarashi/schema';
import { baselineUnavailable, loadBaseline } from '../baseline.js';
import { buildEngineDeps, cliVersion } from '../engine.js';
import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer, printDiagnostics } from '../output.js';
import {
    applyChanges,
    diskReader,
    pinnedDeps,
    plan,
    readProjectConfig,
    specFromConfig,
    unverifiedBlueprints,
    withConfigUpdate,
} from '../project.js';
import { isWrite, reconcile } from '../reconcile.js';
import { buildRegistry } from '../registry-context.js';
import { printChanges, summarizeChanges } from '../review.js';
import { readUserConfig, resolveConfigPath } from '../user-config.js';
import { clack } from '../wizard.js';

export interface RemoveFlags {
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
    offline?: boolean;
    registry?: string;
    verbose?: boolean;
    quiet?: boolean;
    color?: boolean;
    install?: boolean;
}

interface Blocker {
    blueprint: string;
    capability: string;
    providedBy: string;
}

/**
 * A blueprint can go only when nothing that stays behind needs a capability
 * that it alone provides. The resolver would otherwise just add it back.
 */
export function findBlockers(
    manifests: Map<string, LoadedBlueprint['manifest']>,
    removing: Set<string>
): Blocker[] {
    const remaining = [...manifests.values()].filter((manifest) => !removing.has(manifest.id));
    const provided = new Set(remaining.flatMap((manifest) => manifest.provides));
    const blockers: Blocker[] = [];
    for (const manifest of remaining) {
        for (const capability of manifest.requires) {
            if (provided.has(capability)) continue;
            const provider = [...removing].find((id) =>
                manifests.get(id)?.provides.includes(capability)
            );
            if (provider)
                blockers.push({ blueprint: manifest.id, capability, providedBy: provider });
        }
    }
    return blockers;
}

/**
 * Blueprints that were most likely pulled in for the ones being removed:
 * they provide something a removed blueprint required, and nothing that
 * stays requires anything they provide.
 */
export function findOrphans(
    manifests: Map<string, LoadedBlueprint['manifest']>,
    removing: Set<string>
): string[] {
    const removed = [...removing].map((id) => manifests.get(id)!);
    const remaining = [...manifests.values()].filter((manifest) => !removing.has(manifest.id));
    const neededForRemoved = new Set(removed.flatMap((manifest) => manifest.requires));
    return remaining
        .filter((candidate) => candidate.provides.some((token) => neededForRemoved.has(token)))
        .filter(
            (candidate) =>
                !remaining.some(
                    (other) =>
                        other.id !== candidate.id &&
                        other.requires.some((token) => candidate.provides.includes(token))
                )
        )
        .map((manifest) => manifest.id)
        .sort();
}

export async function runRemove(ids: string[], flags: RemoveFlags): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: Boolean(flags.quiet),
        verbose: Boolean(flags.verbose),
        color: flags.color !== false && !flags.json,
    });

    try {
        if (ids.length === 0) {
            throw new CliUsageError('Specify at least one blueprint to remove', [
                'atarashi remove auth/jwt',
            ]);
        }

        const config = await readProjectConfig(cwd);
        const recorded = new Set(config.blueprints.map((blueprint) => blueprint.id));
        const removing = new Set(ids);
        const absent = [...removing].filter((id) => !recorded.has(id));
        if (absent.length > 0) {
            throw new CliUsageError(`Not part of this project: ${absent.join(', ')}`, [
                'Run `atarashi status` to see the blueprints it was generated from',
            ]);
        }

        const userConfig = await readUserConfig(resolveConfigPath());
        const registry = buildRegistry(
            { cwd, offline: flags.offline, registry: flags.registry },
            userConfig
        );
        const interactive =
            Boolean(process.stdout.isTTY) && !flags.yes && !flags.json && !flags.quiet;
        const deps = buildEngineDeps(registry, { hooks: true, interactive: false });

        // Removal re-renders at the recorded versions on both sides, so the
        // only difference between them is the blueprints that are going.
        const baseline = await loadBaseline({
            cwd,
            atarashiVersion: config.atarashiVersion,
            runningVersion: cliVersion(),
            current: registry,
            offline: flags.offline,
        });
        if (!baseline) throw baselineUnavailable(config.atarashiVersion);

        const manifests = new Map<string, LoadedBlueprint['manifest']>();
        for (const id of recorded) {
            const loaded = await baseline.registry.load(id);
            if (loaded) manifests.set(id, loaded.manifest);
        }

        const blockers = findBlockers(manifests, removing);
        if (blockers.length > 0) {
            const diagnostics: Diagnostic[] = blockers.map((blocker) =>
                errorDiagnostic(
                    DIAGNOSTIC_CODES.UNSATISFIED_REQUIREMENT,
                    `${blocker.blueprint} requires \`${blocker.capability}\`, which only ${blocker.providedBy} provides`,
                    {
                        blueprints: [blocker.blueprint, blocker.providedBy],
                        suggestions: [
                            `Remove both: \`atarashi remove ${[...removing, blocker.blueprint].join(' ')}\``,
                        ],
                    }
                )
            );
            throw new AtarashiError(
                DIAGNOSTIC_CODES.UNSATISFIED_REQUIREMENT,
                `Cannot remove ${[...removing].join(', ')}: other blueprints still need it`,
                diagnostics
            );
        }

        const removedPrompts = new Set(
            [...removing].flatMap(
                (id) => manifests.get(id)?.prompts.map((prompt) => prompt.name) ?? []
            )
        );
        const baseSpec = specFromConfig(config);
        let targetSpec: ProjectSpec = {
            ...baseSpec,
            blueprints: baseSpec.blueprints.filter((blueprint) => !removing.has(blueprint.id)),
            answers: Object.fromEntries(
                Object.entries(baseSpec.answers).filter(([name]) => !removedPrompts.has(name))
            ),
        };
        if (flags.install !== undefined) {
            targetSpec = {
                ...targetSpec,
                options: { ...targetSpec.options, install: flags.install },
            };
        }

        const pinned = pinnedDeps(deps, config, baseline.registry);
        const [base, target] = await Promise.all([
            plan(baseSpec, pinned),
            plan(targetSpec, pinned),
        ]);

        const changes = withConfigUpdate(
            reconcile({
                base: base.files,
                target: target.files,
                read: diskReader(cwd),
                unverified: unverifiedBlueprints(config, base),
            }),
            target
        );
        const writable = changes.filter(isWrite);
        const conflicts = changes.filter((change) => change.kind === 'conflict');
        const orphans = findOrphans(manifests, removing);
        const removedList = [...removing];

        if (printer.options.json && flags.dryRun) {
            printer.emitJson({
                ok: true,
                dryRun: true,
                removed: removedList,
                orphans,
                changes: summarizeChanges(changes),
            });
            return EXIT.OK;
        }

        printer.line(`Removing ${removedList.join(', ')} from ${config.name}`);
        printChanges(printer, changes, Boolean(flags.dryRun));

        if (flags.dryRun) {
            printer.line('');
            printer.line('Dry run, nothing was written.');
            return EXIT.OK;
        }

        if (interactive) {
            const proceed = await clack.confirm({
                message: `Write ${writable.length} change(s)${conflicts.length > 0 ? ` and leave ${conflicts.length} conflict(s)` : ''}?`,
                initialValue: true,
            });
            if (clack.isCancel(proceed) || !proceed) {
                printer.line('Cancelled.');
                return EXIT.OK;
            }
        }

        await applyChanges(cwd, writable);

        const packageChanged = writable.some((change) => change.path === 'package.json');
        const installOnly = {
            ...target,
            actions: target.actions.filter((action) => action.kind === 'install' && packageChanged),
        };
        const { outcomes, diagnostics } = await runActions(installOnly, targetSpec, {
            targetDir: cwd,
        });

        if (printer.options.json) {
            printer.emitJson({
                ok: true,
                removed: removedList,
                orphans,
                written: writable.map((change) => ({ path: change.path, kind: change.kind })),
                skipped: conflicts.map((change) => ({ path: change.path, reason: change.note })),
                actions: outcomes,
                warnings: [...target.warnings, ...diagnostics],
            });
        } else {
            printer.success(`Removed ${removedList.join(', ')}`);
            printer.line(`  ${writable.length} file(s) changed`);
            for (const orphan of orphans) {
                printer.detail(
                    `${orphan} may only have been here for what you removed: \`atarashi remove ${orphan}\``
                );
            }
            printDiagnostics(printer, diagnostics);
        }

        const failed = outcomes.some((outcome) => !outcome.ok && !outcome.skipped);
        if (failed) return EXIT.POST_ACTION;
        return conflicts.length > 0 ? EXIT.MERGE_CONFLICT : EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
