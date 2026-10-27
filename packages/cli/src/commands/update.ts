import { type EngineDeps, resolve as resolveGraph, runActions } from '@atarashi/core';
import type { GenerationPlan, ProjectConfig, ProjectSpec } from '@atarashi/schema';
import { baselineUnavailable, loadBaseline } from '../baseline.js';
import { buildEngineDeps, cliVersion } from '../engine.js';
import { reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer, printDiagnostics } from '../output.js';
import {
    applyChanges,
    CONFIG_FILE,
    diskReader,
    pinnedDeps,
    plan,
    readProjectConfig,
    specFromConfig,
    unverifiedBlueprints,
    withConfigUpdate,
} from '../project.js';
import { collectPrompts, fillDefaults, parseDeclaredFlags } from '../prompts.js';
import { isWrite, reconcile } from '../reconcile.js';
import { buildRegistry } from '../registry-context.js';
import { printChanges, summarizeChanges } from '../review.js';
import { readUserConfig, resolveConfigPath } from '../user-config.js';
import { clack } from '../wizard.js';

export interface UpdateFlags {
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
    offline?: boolean;
    registry?: string;
    set?: string[];
    verbose?: boolean;
    quiet?: boolean;
    color?: boolean;
    install?: boolean;
}

export interface VersionChange {
    id: string;
    from: string | null;
    to: string | null;
}

/** Per blueprint: what `atarashi.json` recorded against what the target render used. */
export function versionChanges(config: ProjectConfig, target: GenerationPlan): VersionChange[] {
    const before = new Map(config.blueprints.map((blueprint) => [blueprint.id, blueprint.version]));
    const after = new Map(target.summary.blueprints.map((entry) => [entry.id, entry.version]));
    const ids = [...new Set([...before.keys(), ...after.keys()])].sort();
    return ids
        .map((id) => ({ id, from: before.get(id) ?? null, to: after.get(id) ?? null }))
        .filter((change) => change.from !== change.to);
}

/**
 * The project as the running version would generate it: the same selection
 * and answers, with defaults for any prompt a newer blueprint introduced.
 */
export async function targetSpecFor(
    config: ProjectConfig,
    deps: EngineDeps,
    set: string[] = []
): Promise<ProjectSpec> {
    const spec = specFromConfig(config);
    const graph = await resolveGraph(spec, deps);
    if (!graph.ok) throw graph.error;

    const prompts = collectPrompts(graph.value);
    const { answers } = parseDeclaredFlags([], prompts, set);
    const withAnswers = { ...spec, answers: { ...spec.answers, ...answers } };
    return {
        ...withAnswers,
        answers: fillDefaults(withAnswers, graph.value, prompts, {
            atarashiVersion: deps.atarashiVersion,
            now: new Date(config.generatedAt),
        }),
    };
}

const formatVersion = (change: VersionChange): string =>
    change.from === null
        ? `${change.id} ${change.to} (new requirement)`
        : change.to === null
          ? `${change.id} ${change.from} (no longer resolved)`
          : `${change.id} ${change.from} → ${change.to}`;

export async function runUpdate(flags: UpdateFlags): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: Boolean(flags.quiet),
        verbose: Boolean(flags.verbose),
        color: flags.color !== false && !flags.json,
    });

    try {
        const config = await readProjectConfig(cwd);
        const userConfig = await readUserConfig(resolveConfigPath());
        const registry = buildRegistry(
            { cwd, offline: flags.offline, registry: flags.registry },
            userConfig
        );
        const interactive =
            Boolean(process.stdout.isTTY) && !flags.yes && !flags.json && !flags.quiet;
        const deps = buildEngineDeps(registry, { hooks: true, interactive });

        const baseline = await loadBaseline({
            cwd,
            atarashiVersion: config.atarashiVersion,
            runningVersion: cliVersion(),
            current: registry,
            offline: flags.offline,
        });
        if (!baseline) throw baselineUnavailable(config.atarashiVersion);

        const base = await plan(
            specFromConfig(config),
            pinnedDeps(deps, config, baseline.registry)
        );
        const targetDeps = pinnedDeps(deps, config, registry, cliVersion());
        let targetSpec = await targetSpecFor(config, targetDeps, flags.set);
        if (flags.install !== undefined) {
            targetSpec = {
                ...targetSpec,
                options: { ...targetSpec.options, install: flags.install },
            };
        }
        const target = await plan(targetSpec, targetDeps);

        const versions = versionChanges(config, target);
        const changes = withConfigUpdate(
            reconcile({
                base: base.files,
                target: target.files,
                read: diskReader(cwd),
                unverified: unverifiedBlueprints(config, base),
            }),
            target
        );
        const meaningful = changes.filter(
            (change) => change.path !== CONFIG_FILE && change.kind !== 'unchanged'
        );

        if (meaningful.length === 0 && versions.length === 0) {
            if (printer.options.json) {
                printer.emitJson({ ok: true, upToDate: true, versions: [], changes: [] });
            } else {
                printer.success(`${config.name} is up to date with atarashi ${cliVersion()}`);
            }
            return EXIT.OK;
        }

        const writable = changes.filter(isWrite);
        const conflicts = changes.filter((change) => change.kind === 'conflict');

        if (printer.options.json && flags.dryRun) {
            printer.emitJson({
                ok: true,
                dryRun: true,
                upToDate: false,
                versions,
                changes: summarizeChanges(changes),
            });
            return EXIT.OK;
        }

        printer.line(
            `Updating ${config.name} (atarashi ${config.atarashiVersion} → ${cliVersion()})`
        );
        for (const change of versions) printer.line(`  ${formatVersion(change)}`);
        printer.line('');
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
                upToDate: false,
                versions,
                written: writable.map((change) => ({ path: change.path, kind: change.kind })),
                skipped: conflicts.map((change) => ({ path: change.path, reason: change.note })),
                actions: outcomes,
                warnings: [...target.warnings, ...diagnostics],
            });
        } else {
            printer.success(`Updated ${config.name}`);
            printer.line(`  ${writable.length} file(s) changed`);
            if (conflicts.length > 0) {
                printer.detail(
                    'The changes printed above for each conflict are yours to apply by hand'
                );
            }
            printDiagnostics(printer, [...target.warnings, ...diagnostics]);
        }

        const failed = outcomes.some((outcome) => !outcome.ok && !outcome.skipped);
        if (failed) return EXIT.POST_ACTION;
        return conflicts.length > 0 ? EXIT.MERGE_CONFLICT : EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
