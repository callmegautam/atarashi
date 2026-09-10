import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { generate, resolve as resolveGraph } from '@atarashi/core';
import { type ProjectSpec, parseProjectConfig, type SelectedBlueprint } from '@atarashi/schema';
import { buildEngineDeps } from '../engine.js';
import { reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';
import { buildRegistry } from '../registry-context.js';
import { readUserConfig, resolveConfigPath } from '../user-config.js';

export interface DoctorFlags {
    fix?: boolean;
    json?: boolean;
    color?: boolean;
    offline?: boolean;
}

interface Check {
    ok: boolean | 'warn';
    label: string;
    fix?: () => Promise<string>;
}

async function commandVersion(command: string, args: string[]): Promise<string | undefined> {
    return new Promise((resolvePromise) => {
        const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'ignore'] });
        let out = '';
        child.stdout?.on('data', (chunk) => {
            out += chunk.toString();
        });
        child.on('error', () => resolvePromise(undefined));
        child.on('close', (code) =>
            resolvePromise(code === 0 ? out.trim().split('\n')[0] : undefined)
        );
    });
}

export async function runDoctor(flags: DoctorFlags): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });

    try {
        const checks: Check[] = [];

        const nodeVersion = process.version;
        checks.push({
            ok: Number(nodeVersion.slice(1).split('.')[0]) >= 20,
            label: `node        ${nodeVersion} (>=20.11 required)`,
        });

        const gitVersion = await commandVersion('git', ['--version']);
        checks.push({
            ok: gitVersion !== undefined,
            label: `git         ${gitVersion ?? 'not found'}`,
        });

        const userConfig = await readUserConfig(resolveConfigPath());
        const registry = buildRegistry({ cwd, offline: flags.offline }, userConfig);
        const cachedVersions = await registry.cachedVersions();
        checks.push({
            ok: cachedVersions.length > 0 || registry.offline,
            label: `registry    ${cachedVersions.at(-1) ?? '(nothing cached)'}${registry.offline ? '  (offline)' : ''}`,
        });

        const configPath = join(cwd, 'atarashi.json');
        if (existsSync(configPath)) {
            const configResult = parseProjectConfig(
                JSON.parse(await readFile(configPath, 'utf8')),
                configPath
            );
            if (!configResult.ok) {
                checks.push({
                    ok: false,
                    label: `atarashi.json invalid — ${configResult.error.message}`,
                });
            } else {
                const config = configResult.value;
                checks.push({ ok: true, label: 'atarashi.json valid' });

                const spec: ProjectSpec = {
                    specVersion: config.specVersion,
                    name: config.name,
                    description: config.description,
                    blueprints: config.blueprints.map(
                        (b): SelectedBlueprint => ({ id: b.id, reason: 'user' })
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
                const deps = buildEngineDeps(registry, { hooks: false, interactive: false });
                const graph = await resolveGraph(spec, deps);

                if (graph.ok) {
                    for (const node of graph.value.nodes) {
                        const providers = await registry.providersOf(
                            node.blueprint.manifest.provides[0] ?? ''
                        );
                        const latest = providers.find((p) => p.id === node.blueprint.manifest.id);
                        if (latest && latest.version !== node.blueprint.manifest.version) {
                            checks.push({
                                ok: 'warn',
                                label: `${node.blueprint.manifest.id} ${node.blueprint.manifest.version} → ${latest.version} available   (atarashi add ${node.blueprint.manifest.id}@${latest.version})`,
                            });
                        }
                    }

                    const result = await generate(spec, deps);
                    if (result.ok) {
                        const envExample = result.value.files.find(
                            (f) => f.path === '.env.example'
                        );
                        const declaredKeys =
                            typeof envExample?.contents === 'string'
                                ? [...envExample.contents.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map(
                                      (m) => m[1]!
                                  )
                                : [];
                        const envPath = join(cwd, '.env');
                        const envContents = existsSync(envPath)
                            ? await readFile(envPath, 'utf8')
                            : '';
                        const present = new Set(
                            [...envContents.matchAll(/^([A-Z][A-Z0-9_]*)=/gm)].map((m) => m[1]!)
                        );
                        const missing = declaredKeys.filter((key) => !present.has(key));

                        if (missing.length > 0) {
                            checks.push({
                                ok: 'warn',
                                label: `.env missing ${missing.join(', ')}`,
                                fix: async () => {
                                    const addition = missing.map((key) => `${key}=\n`).join('');
                                    await appendFile(envPath, addition, 'utf8');
                                    return `Appended ${missing.length} key(s) to .env`;
                                },
                            });
                        } else if (declaredKeys.length > 0) {
                            checks.push({ ok: true, label: '.env has every declared key' });
                        }
                    }
                } else {
                    checks.push({
                        ok: false,
                        label: `project no longer resolves: ${graph.error.message}`,
                    });
                }
            }
        }

        let fixed = 0;
        if (flags.fix) {
            for (const check of checks) {
                if (check.ok === 'warn' && check.fix) {
                    const message = await check.fix();
                    checks.push({ ok: true, label: message });
                    fixed += 1;
                }
            }
        }

        const issues = checks.filter((check) => check.ok !== true);

        if (printer.options.json) {
            printer.emitJson({
                ok: issues.filter((c) => c.ok === false).length === 0,
                checks: checks.map((c) => ({ ok: c.ok, label: c.label })),
                fixed,
            });
        } else {
            printer.line('Environment');
            for (const check of checks) {
                const icon = check.ok === true ? '✔' : check.ok === 'warn' ? '⚠' : '✖';
                printer.line(`  ${icon} ${check.label}`);
            }
            printer.line('');
            const fixable = checks.filter((check) => check.ok === 'warn' && check.fix).length;
            printer.line(
                `${issues.length} issue(s).${fixable > 0 && !flags.fix ? ` Run with --fix to apply ${fixable} automatic fix(es).` : ''}${flags.fix ? ` Applied ${fixed} fix(es).` : ''}`
            );
        }

        return checks.some((check) => check.ok === false) ? EXIT.RUNTIME : EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
