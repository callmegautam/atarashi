import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, resolve as resolvePath } from 'node:path';
import {
    commit,
    type EngineDeps,
    generate,
    resolve as resolveGraph,
    runActions,
} from '@atarashi/core';
import {
    CURRENT_SPEC_VERSION,
    type JsonValue,
    type PresetManifest,
    type ProjectSpec,
    parseProjectConfig,
    parseProjectSpec,
    type SelectedBlueprint,
} from '@atarashi/schema';
import { buildEngineDeps } from '../engine.js';
import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { resolveLegacyPreset } from '../legacy-aliases.js';
import { partitionNpmSpecs, resolveNpmBlueprintIds } from '../npm-blueprints.js';
import { bytes, Printer, printDiagnostics } from '../output.js';
import type { OptionFlags } from '../project-options.js';
import { resolveProjectOptions } from '../project-options.js';
import { collectPrompts, fillDefaults, parseDeclaredFlags } from '../prompts.js';
import { buildRegistry } from '../registry-context.js';
import { resolveSelection } from '../selection.js';
import { expandShorthand, type ShorthandFlags } from '../shorthand.js';
import { readUserConfig, resolveConfigPath } from '../user-config.js';
import {
    askInstall,
    askPackageManager,
    askProjectName,
    askPrompts,
    confirmCreate,
    pickBlueprints,
    pickStart,
    WizardCancelled,
} from '../wizard.js';

export interface NewFlags extends OptionFlags, ShorthandFlags {
    preset?: string;
    add?: string[];
    remove?: string[];
    from?: string;
    set?: string[];
    yes?: boolean;
    dir?: string;
    dryRun?: boolean;
    json?: boolean;
    offline?: boolean;
    registry?: string;
    /** `--no-hooks` sets this to `false`. */
    hooks?: boolean;
    verbose?: boolean;
    quiet?: boolean;
    color?: boolean;
    description?: string;
}

/** `--from <path>` — a local `atarashi.json` or bare `ProjectSpec` to start from. */
async function loadFromFile(path: string): Promise<{
    blueprints: SelectedBlueprint[];
    answers: Record<string, JsonValue>;
    name?: string;
}> {
    if (/^https?:\/\//.test(path)) {
        throw new CliUsageError('`--from <url>` is not available yet — pass a local file path');
    }
    if (!existsSync(path)) throw new CliUsageError(`No file at ${path}`);

    const raw = JSON.parse(await readFile(path, 'utf8'));
    const asConfig = parseProjectConfig(raw, path);
    if (asConfig.ok) {
        return {
            blueprints: asConfig.value.blueprints.map((b) => ({
                id: b.id,
                reason: 'user' as const,
            })),
            answers: asConfig.value.answers,
            name: asConfig.value.name,
        };
    }
    const asSpec = parseProjectSpec(raw, path);
    if (asSpec.ok) {
        return {
            blueprints: asSpec.value.blueprints,
            answers: asSpec.value.answers,
            name: asSpec.value.name,
        };
    }
    throw asConfig.error;
}

/**
 * Whether anything the user explicitly asked for already claims `language`.
 * Blueprints that do conflict with each other, so the default runtime must
 * stand down rather than be added alongside.
 */
async function providesLanguage(
    registry: { summaries(): Promise<{ id: string; provides: string[] }[]> },
    ids: string[]
): Promise<boolean> {
    if (ids.length === 0) return false;
    const summaries = await registry.summaries();
    const wanted = new Set(ids);
    return summaries.some(
        (summary) => wanted.has(summary.id) && summary.provides.includes('language')
    );
}

export async function runNew(
    name: string | undefined,
    extra: string[],
    flags: NewFlags
): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: Boolean(flags.quiet),
        verbose: Boolean(flags.verbose),
        color: flags.color !== false && !flags.json,
    });

    try {
        const userConfig = await readUserConfig(resolveConfigPath());
        // `--add npm:atarashi-blueprint-x` names a package, not a blueprint id;
        // the registry needs the package registered before it can load from it.
        const npm = partitionNpmSpecs(flags.add ?? []);
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

        let selection: { blueprints: SelectedBlueprint[]; answers: Record<string, JsonValue> };
        let preset: PresetManifest | undefined;
        let fromName: string | undefined;

        if (flags.from) {
            const loaded = await loadFromFile(flags.from);
            selection = { blueprints: loaded.blueprints, answers: loaded.answers };
            fromName = loaded.name;
        } else {
            const shorthand = expandShorthand(flags);
            const add = [
                ...npm.ids,
                ...(await resolveNpmBlueprintIds(registry, npm.packages)),
                ...shorthand.add,
            ];
            const remove = [...(flags.remove ?? []), ...shorthand.remove];
            let customIds: string[] | undefined;

            if (flags.preset) {
                // A real preset always wins over a v0.6 alias of the same name.
                // `backend-mongo` is both, and rewriting it to the alias handed
                // the user a `backend-ts` that already carries db/postgres.
                preset = await registry.loadPreset(`preset/${flags.preset}`);
                if (!preset) {
                    const alias = resolveLegacyPreset(flags.preset);
                    if (alias.notice) printer.warn(alias.notice);
                    preset = await registry.loadPreset(`preset/${alias.preset}`);
                    if (!preset) throw new CliUsageError(`Unknown preset "${flags.preset}"`);
                    add.push(...alias.add);
                    remove.push(...alias.remove);
                }
            } else if (add.length === 0 && interactive) {
                const presets = await registry.presets();
                const choice = await pickStart(presets);
                if (choice.preset) {
                    preset = choice.preset;
                } else {
                    const summaries = await registry.summaries();
                    customIds = await pickBlueprints(
                        'Pick blueprints (space to select, enter to confirm)',
                        summaries,
                        ['core/node-ts']
                    );
                }
            }

            // Seed the default runtime only when nothing chosen already brings
            // a language. Seeding it unconditionally made `--add core/node-js`
            // unresolvable, since both claim `language`.
            if (!preset && !customIds && !(await providesLanguage(registry, add))) {
                customIds = ['core/node-ts'];
            }
            selection = resolveSelection({ preset, custom: customIds, add, remove });
        }

        const projectName =
            name ??
            fromName ??
            (interactive
                ? await askProjectName(basename(cwd))
                : (() => {
                      throw new CliUsageError('A project name is required', [
                          'atarashi new <name> …',
                      ]);
                  })());

        const targetDir = resolvePath(cwd, flags.dir ?? projectName);
        const options = resolveProjectOptions(flags, userConfig, cwd);

        const specResult = parseProjectSpec({
            specVersion: CURRENT_SPEC_VERSION,
            name: projectName,
            description: flags.description,
            targetDir,
            preset: preset?.id,
            blueprints: selection.blueprints,
            answers: selection.answers,
            options,
        });
        if (!specResult.ok) throw specResult.error;
        let spec: ProjectSpec = specResult.value;

        const deps: EngineDeps = buildEngineDeps(registry, {
            hooks: flags.hooks !== false,
            interactive,
        });

        const graph = await resolveGraph(spec, deps);
        if (!graph.ok) throw graph.error;

        const declaredPrompts = collectPrompts(graph.value);
        const { answers: flagAnswers, unknown } = parseDeclaredFlags(
            extra,
            declaredPrompts,
            flags.set
        );
        if (unknown.length > 0) {
            throw new CliUsageError(`Unknown option(s): ${unknown.join(' ')}`, [
                'Run `atarashi info <blueprint>` to see its flags',
                '`atarashi new --help` lists every global flag',
            ]);
        }

        spec = { ...spec, answers: { ...spec.answers, ...flagAnswers } };

        const now = new Date();
        if (interactive) {
            const answers = await askPrompts(declaredPrompts, spec, graph.value, {
                atarashiVersion: deps.atarashiVersion,
                now,
            });
            spec = { ...spec, answers };

            if (flags.pm === undefined) {
                const pm = await askPackageManager(spec.options.packageManager);
                spec = { ...spec, options: { ...spec.options, packageManager: pm } };
            }
            if (flags.install === undefined) {
                const install = await askInstall(spec.options.install);
                spec = { ...spec, options: { ...spec.options, install } };
            }
        } else {
            const answers = fillDefaults(spec, graph.value, declaredPrompts, {
                atarashiVersion: deps.atarashiVersion,
                now,
            });
            spec = { ...spec, answers };
        }

        const result = await generate(spec, deps);
        if (!result.ok) throw result.error;
        const plan = result.value;

        if (flags.dryRun) {
            if (printer.options.json) {
                printer.emitJson({
                    ok: true,
                    dryRun: true,
                    spec,
                    summary: plan.summary,
                    warnings: plan.warnings,
                });
            } else {
                printer.line(`Plan for ${spec.name} (dry run — nothing was written)`);
                printer.line(
                    `  ${plan.summary.fileCount} files · ${plan.summary.totalBytes > 0 ? bytes(plan.summary.totalBytes) : '0 B'} · ${plan.summary.deps.dependencies.length} deps · ${plan.summary.deps.devDependencies.length} dev deps`
                );
                printer.line(`  blueprints: ${plan.summary.blueprints.map((b) => b.id).join(' ')}`);
                printDiagnostics(printer, plan.warnings);
            }
            return EXIT.OK;
        }

        if (interactive) {
            const create = await confirmCreate(plan);
            if (!create) {
                printer.line('Cancelled.');
                return EXIT.OK;
            }
        }

        const written = commit(plan, targetDir, { force: spec.options.force });
        if (!written.ok) throw written.error;

        const { outcomes, diagnostics } = await runActions(plan, spec, {
            targetDir,
            onOutput: flags.verbose ? (chunk) => process.stderr.write(chunk) : undefined,
        });

        if (printer.options.json) {
            printer.emitJson({
                ok: true,
                spec,
                summary: plan.summary,
                warnings: [...plan.warnings, ...diagnostics],
                actions: outcomes,
                nextSteps: plan.summary.nextSteps,
            });
        } else {
            printer.success(`Created ${spec.name}`);
            printer.line('');
            printer.line(
                `  ${plan.summary.fileCount} files · ${plan.summary.deps.dependencies.length + plan.summary.deps.devDependencies.length} dependencies · ${spec.options.packageManager}`
            );
            printDiagnostics(printer, [...plan.warnings, ...diagnostics]);
            if (plan.summary.nextSteps.length > 0) {
                printer.line('');
                printer.line('  Next steps');
                for (const step of plan.summary.nextSteps) printer.line(`    ${step}`);
            }
        }

        const failed = outcomes.some((outcome) => !outcome.ok && !outcome.skipped);
        return failed ? EXIT.POST_ACTION : EXIT.OK;
    } catch (thrown) {
        if (thrown instanceof WizardCancelled) {
            printer.line('Cancelled.');
            // Ctrl-C is an interruption, not a success — a script wrapping this
            // needs to be able to tell the difference. Doc 04 § Exit codes.
            return EXIT.INTERRUPTED;
        }
        return reportError(printer, thrown);
    }
}
