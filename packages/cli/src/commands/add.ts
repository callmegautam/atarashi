import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve as resolvePath, sep } from 'node:path';
import {
    type EngineDeps,
    findSlots,
    generate,
    injectSlots,
    normalizeProjectPath,
    resolve as resolveGraph,
    runActions,
} from '@atarashi/core';
import { type ProjectSpec, parseProjectConfig, type SelectedBlueprint } from '@atarashi/schema';
import { formatDiff, lineDiff } from '../diff.js';
import { buildEngineDeps } from '../engine.js';
import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { partitionNpmSpecs, resolveNpmBlueprintIds } from '../npm-blueprints.js';
import { bytes, Printer, printDiagnostics } from '../output.js';
import { collectPrompts, fillDefaults, parseDeclaredFlags } from '../prompts.js';
import { buildRegistry } from '../registry-context.js';
import { readUserConfig, resolveConfigPath } from '../user-config.js';
import { clack } from '../wizard.js';

export interface AddFlags {
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
    force?: boolean;
    offline?: boolean;
    registry?: string;
    set?: string[];
    verbose?: boolean;
    quiet?: boolean;
    color?: boolean;
    install?: boolean;
}

type ChangeKind = 'new' | 'update' | 'slot-merge' | 'conflict' | 'unchanged';

interface Change {
    path: string;
    kind: ChangeKind;
    contents?: string | Buffer;
    mode?: number;
    diffAgainst?: string;
    note?: string;
}

const asBuffer = (value: string | Buffer): Buffer =>
    Buffer.isBuffer(value) ? value : Buffer.from(value, 'utf8');
const buffersEqual = (a: string | Buffer, b: string | Buffer): boolean =>
    asBuffer(a).equals(asBuffer(b));

/**
 * Fills only the slots that changed between the old and new render of a file,
 * splicing them into the on-disk (possibly hand-edited) copy. Bails to a
 * conflict — never a silent, partial write — the moment a needed marker is
 * gone or the file has none at all.
 */
function attemptSlotMerge(
    onDisk: string,
    oldRender: string,
    newRender: string
): string | undefined {
    const newMarkers = findSlots(newRender);
    if (newMarkers.length === 0) return undefined;

    const oldMarkers = findSlots(oldRender);
    const oldLines = oldRender.split('\n');
    const newLines = newRender.split('\n');

    const contributions = new Map<string, string[]>();
    for (const marker of newMarkers) {
        const newInner = newLines.slice(marker.startLine + 1, marker.endLine).join('\n');
        const oldMarker = oldMarkers.find((candidate) => candidate.slot === marker.slot);
        const oldInner = oldMarker
            ? oldLines.slice(oldMarker.startLine + 1, oldMarker.endLine).join('\n')
            : '';
        if (newInner.trim().length > 0 && newInner !== oldInner) {
            contributions.set(marker.slot, [newInner]);
        }
    }
    if (contributions.size === 0) return undefined;

    const injected = injectSlots(onDisk, contributions);
    if (injected.missing.length > 0) return undefined;
    return injected.contents;
}

export async function runAdd(ids: string[], extra: string[], flags: AddFlags): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: Boolean(flags.quiet),
        verbose: Boolean(flags.verbose),
        color: flags.color !== false && !flags.json,
    });

    try {
        if (ids.length === 0) {
            throw new CliUsageError('Specify at least one blueprint to add', [
                'atarashi add auth/jwt',
            ]);
        }

        const configPath = join(cwd, 'atarashi.json');
        if (!existsSync(configPath)) {
            throw new CliUsageError('No `atarashi.json` in this directory', [
                'Run `atarashi new` first, or `cd` into a generated project',
            ]);
        }

        const configResult = parseProjectConfig(
            JSON.parse(await readFile(configPath, 'utf8')),
            configPath
        );
        if (!configResult.ok) throw configResult.error;
        const config = configResult.value;

        const userConfig = await readUserConfig(resolveConfigPath());
        // See `new` — a `npm:` argument names a package, and the registry has to
        // know about it before the blueprint inside it can be resolved.
        const npm = partitionNpmSpecs(ids);
        const registry = buildRegistry(
            {
                cwd,
                offline: flags.offline,
                registry: flags.registry,
                npmPackages: npm.packages,
            },
            userConfig
        );
        const interactive =
            Boolean(process.stdout.isTTY) && !flags.yes && !flags.json && !flags.quiet;
        const deps: EngineDeps = buildEngineDeps(registry, { hooks: true, interactive });

        const requested = [...npm.ids, ...(await resolveNpmBlueprintIds(registry, npm.packages))];
        const existingIds = new Set(config.blueprints.map((blueprint) => blueprint.id));
        const newIds = requested.filter((id) => !existingIds.has(id));
        if (newIds.length === 0) {
            printer.line('Already present — nothing to add.');
            return EXIT.OK;
        }

        const oldSpec: ProjectSpec = {
            specVersion: config.specVersion,
            name: config.name,
            description: config.description,
            registry: config.registry,
            preset: config.preset,
            blueprints: config.blueprints.map(
                (blueprint): SelectedBlueprint => ({
                    id: blueprint.id,
                    reason: 'user',
                })
            ),
            answers: config.answers,
            options: {
                packageManager: 'pnpm',
                git: true,
                install: true,
                format: true,
                initialCommit: true,
                license: 'MIT',
                author: null,
                writeEnv: false,
                force: false,
                ...config.options,
            },
        };

        let newSpec: ProjectSpec = {
            ...oldSpec,
            blueprints: [
                ...oldSpec.blueprints,
                ...newIds.map((id): SelectedBlueprint => ({ id, reason: 'user' })),
            ],
        };
        if (flags.install !== undefined) {
            newSpec = { ...newSpec, options: { ...newSpec.options, install: flags.install } };
        }

        const graphResult = await resolveGraph(newSpec, deps);
        if (!graphResult.ok) throw graphResult.error;

        const prompts = collectPrompts(graphResult.value);
        const { answers: flagAnswers, unknown } = parseDeclaredFlags(extra, prompts, flags.set);
        if (unknown.length > 0) {
            throw new CliUsageError(`Unknown option(s): ${unknown.join(' ')}`, [
                'Run `atarashi info <blueprint>` to see its flags',
            ]);
        }
        newSpec = { ...newSpec, answers: { ...newSpec.answers, ...flagAnswers } };
        newSpec = {
            ...newSpec,
            answers: fillDefaults(newSpec, graphResult.value, prompts, {
                atarashiVersion: deps.atarashiVersion,
                now: new Date(),
            }),
        };

        // Regenerate the *original* graph too, pinned to the moment it was
        // actually generated — the baseline every on-disk file is diffed
        // against to tell "untouched since generation" from "hand-edited".
        const originalNow = new Date(config.generatedAt);
        const oldDeps: EngineDeps = {
            ...deps,
            atarashiVersion: config.atarashiVersion,
            now: () => originalNow,
        };

        const [oldResult, newResult] = await Promise.all([
            generate(oldSpec, oldDeps),
            generate(newSpec, deps),
        ]);
        if (!oldResult.ok) throw oldResult.error;
        if (!newResult.ok) throw newResult.error;

        const oldFiles = new Map(oldResult.value.files.map((file) => [file.path, file]));
        const changes: Change[] = [];

        for (const file of newResult.value.files) {
            const old = oldFiles.get(file.path);
            const onDiskPath = join(cwd, file.path);
            const onDisk = existsSync(onDiskPath) ? await readFile(onDiskPath) : undefined;

            if (!old) {
                if (onDisk !== undefined) {
                    changes.push({
                        path: file.path,
                        kind: 'conflict',
                        note: 'a file already exists here',
                    });
                } else {
                    changes.push({
                        path: file.path,
                        kind: 'new',
                        contents: file.contents,
                        mode: file.mode,
                    });
                }
                continue;
            }

            if (onDisk === undefined) {
                changes.push({
                    path: file.path,
                    kind: 'update',
                    contents: file.contents,
                    mode: file.mode,
                });
                continue;
            }
            if (buffersEqual(onDisk, file.contents)) {
                changes.push({ path: file.path, kind: 'unchanged' });
                continue;
            }
            if (buffersEqual(onDisk, old.contents)) {
                changes.push({
                    path: file.path,
                    kind: 'update',
                    contents: file.contents,
                    mode: file.mode,
                    diffAgainst: typeof old.contents === 'string' ? old.contents : undefined,
                });
                continue;
            }

            if (!file.binary && !old.binary) {
                const merged = attemptSlotMerge(
                    onDisk.toString('utf8'),
                    old.contents as string,
                    file.contents as string
                );
                if (merged !== undefined) {
                    changes.push({
                        path: file.path,
                        kind: 'slot-merge',
                        contents: merged,
                        mode: file.mode,
                        diffAgainst: onDisk.toString('utf8'),
                    });
                    continue;
                }
            }

            changes.push({
                path: file.path,
                kind: 'conflict',
                note: 'edited since generation; no slot region to merge the new content into',
            });
        }

        const writable = changes.filter(
            (change) => change.kind !== 'conflict' && change.kind !== 'unchanged'
        );
        const conflicts = changes.filter((change) => change.kind === 'conflict');

        if (printer.options.json && flags.dryRun) {
            printer.emitJson({
                ok: true,
                dryRun: true,
                added: newIds,
                changes: changes.map(({ path, kind, note }) => ({ path, kind, note })),
            });
            return EXIT.OK;
        }

        printer.line(`Adding ${newIds.join(', ')} to ${config.name}`);
        for (const change of writable) {
            const icon = change.kind === 'new' ? '+' : change.kind === 'slot-merge' ? '~' : '·';
            printer.line(`  ${icon} ${change.path} (${change.kind})`);
            if (
                flags.dryRun &&
                change.diffAgainst !== undefined &&
                typeof change.contents === 'string'
            ) {
                const diff = lineDiff(change.diffAgainst, change.contents);
                if (diff) printer.line(formatDiff(diff));
            }
        }
        for (const change of conflicts) {
            printer.warn(`${change.path}: ${change.note} — left untouched`);
        }

        if (flags.dryRun) {
            printer.line('');
            printer.line('Dry run — nothing was written.');
            return EXIT.OK;
        }

        if (writable.length === 0) {
            printer.line('Nothing safe to write — every touched file was edited since generation.');
            return conflicts.length > 0 ? EXIT.MERGE_CONFLICT : EXIT.OK;
        }

        if (interactive) {
            const proceed = await clack.confirm({
                message: `Write ${writable.length} file(s)${conflicts.length > 0 ? ` and skip ${conflicts.length} conflict(s)` : ''}?`,
                initialValue: true,
            });
            if (clack.isCancel(proceed) || !proceed) {
                printer.line('Cancelled.');
                return EXIT.OK;
            }
        }

        for (const change of writable) {
            const destination = resolvePath(cwd, normalizeProjectPath(change.path));
            if (destination !== cwd && !destination.startsWith(cwd + sep)) {
                throw new CliUsageError(`Refusing to write \`${change.path}\` outside the project`);
            }
            await mkdir(dirname(destination), { recursive: true });
            await writeFile(destination, change.contents!, { mode: change.mode });
        }

        const installOnly = {
            ...newResult.value,
            actions: newResult.value.actions.filter((action) => action.kind === 'install'),
        };
        const { outcomes, diagnostics } = await runActions(installOnly, newSpec, {
            targetDir: cwd,
        });

        if (printer.options.json) {
            printer.emitJson({
                ok: true,
                added: newIds,
                written: writable.map((change) => change.path),
                skipped: conflicts.map((change) => ({ path: change.path, reason: change.note })),
                actions: outcomes,
                warnings: [...newResult.value.warnings, ...diagnostics],
            });
        } else {
            printer.success(`Added ${newIds.join(', ')}`);
            printer.line(
                `  ${bytes(writable.reduce((total, c) => total + (c.contents ? asBuffer(c.contents).byteLength : 0), 0))} written across ${writable.length} file(s)`
            );
            printDiagnostics(printer, [...newResult.value.warnings, ...diagnostics]);
        }

        const failed = outcomes.some((outcome) => !outcome.ok && !outcome.skipped);
        if (failed) return EXIT.POST_ACTION;
        return conflicts.length > 0 ? EXIT.MERGE_CONFLICT : EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
