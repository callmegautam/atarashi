import { NPM_PREFIX, parseNpmSpec } from '@atarashi/registry';
import type { RegistrySource } from '@atarashi/schema';
import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';
import { buildRegistry } from '../registry-context.js';
import {
    readUserConfig,
    resolveConfigPath,
    setConfigValue,
    unsetConfigValue,
    writeUserConfig,
} from '../user-config.js';

export interface RegistryFlags {
    dryRun?: boolean;
    json?: boolean;
    color?: boolean;
    offline?: boolean;
    registry?: string;
}

/** Doc 09 § T6: report the change and make none. */
function wouldDo(printer: Printer, description: string, detail: Record<string, unknown>): number {
    if (printer.options.json) printer.emitJson({ ok: true, dryRun: true, ...detail });
    else {
        printer.line(`Would ${description}`);
        printer.line('Nothing was written (--dry-run).');
    }
    return EXIT.OK;
}

export async function runRegistry(
    action: string | undefined,
    args: string[],
    flags: RegistryFlags
): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });
    const configPath = resolveConfigPath();

    try {
        const userConfig = await readUserConfig(configPath);
        const registry = buildRegistry(
            { cwd, offline: flags.offline, registry: flags.registry },
            userConfig
        );

        switch (action) {
            case 'update': {
                const results = await registry.update();
                if (printer.options.json) printer.emitJson({ ok: true, results });
                else
                    for (const result of results)
                        printer.success(`${result.name}: ${result.version} (from ${result.from})`);
                return EXIT.OK;
            }

            case 'list': {
                const versions = await registry.cachedVersions();
                if (printer.options.json) printer.emitJson({ ok: true, versions });
                else for (const version of versions) printer.line(version);
                return EXIT.OK;
            }

            case 'pin': {
                const [version] = args;
                if (!version) throw new CliUsageError('atarashi registry pin <version>');
                if (flags.dryRun) {
                    return wouldDo(printer, `pin the registry to ${version} in ${configPath}`, {
                        change: 'pin',
                        version,
                        path: configPath,
                    });
                }
                const next = setConfigValue(userConfig, 'registry.pin', version);
                await writeUserConfig(next, configPath);
                printer.success(`Pinned the registry to ${version}`);
                return EXIT.OK;
            }

            case 'unpin': {
                if (flags.dryRun) {
                    return wouldDo(printer, `unpin the registry in ${configPath}`, {
                        change: 'unpin',
                        was: userConfig.registry?.pin ?? null,
                        path: configPath,
                    });
                }
                const next = unsetConfigValue(userConfig, 'registry.pin');
                await writeUserConfig(next, configPath);
                printer.success('Unpinned the registry');
                return EXIT.OK;
            }

            case 'verify': {
                const report = await registry.verifyCache();
                if (printer.options.json) printer.emitJson({ ok: true, report });
                else printer.line(JSON.stringify(report, null, 2));
                return EXIT.OK;
            }

            case 'clear': {
                if (flags.dryRun) {
                    return wouldDo(
                        printer,
                        `clear the blueprint cache at ${registry.cache.layout.root}`,
                        {
                            change: 'clear',
                            path: registry.cache.layout.root,
                        }
                    );
                }
                await registry.clearCache();
                printer.success('Cache cleared');
                return EXIT.OK;
            }

            case 'add': {
                const [spec] = args;
                if (!spec) throw new CliUsageError('atarashi registry add <url|npm:pkg>');
                if (spec.startsWith(NPM_PREFIX)) {
                    if (!parseNpmSpec(spec)) {
                        throw new CliUsageError(
                            `"${spec}" is not a valid npm blueprint package spec`
                        );
                    }
                    // npm packages resolve per-invocation, not as a persisted source.
                    printer.line(`\`${spec}\` resolves per-run — pass it directly:`);
                    printer.line(`  atarashi new my-api --add ${spec}`);
                    return EXIT.OK;
                }

                let url: URL;
                try {
                    url = new URL(spec);
                } catch {
                    throw new CliUsageError(`"${spec}" is not a valid URL or npm: spec`);
                }
                const source: RegistrySource = {
                    name: url.hostname,
                    url: url.toString(),
                    trusted: false,
                    enabled: true,
                };
                const sources = [
                    ...(userConfig.registry?.sources ?? []).filter((s) => s.url !== source.url),
                    source,
                ];
                if (flags.dryRun) {
                    return wouldDo(
                        printer,
                        `add registry source ${source.name} (${source.url}) to ${configPath}`,
                        { change: 'add-source', source, path: configPath }
                    );
                }
                const next = { ...userConfig, registry: { ...userConfig.registry, sources } };
                await writeUserConfig(next, configPath);
                printer.success(`Added registry source ${source.name} (${source.url})`);
                return EXIT.OK;
            }

            case 'sources': {
                const sources = userConfig.registry?.sources ?? [
                    {
                        name: 'atarashi',
                        url: 'https://atarashi.gautamsuthar.in/registry',
                        trusted: true,
                        enabled: true,
                    },
                ];
                if (printer.options.json) printer.emitJson({ ok: true, sources });
                else
                    for (const source of sources)
                        printer.line(
                            `${source.name}  ${source.url}${source.trusted ? '' : '  (untrusted)'}`
                        );
                return EXIT.OK;
            }

            default:
                throw new CliUsageError(
                    `Unknown \`atarashi registry\` subcommand "${action ?? ''}"`,
                    ['atarashi registry update|list|pin|unpin|verify|clear|add|sources']
                );
        }
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
