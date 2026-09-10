import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';
import {
    flattenConfig,
    getConfigValue,
    readUserConfig,
    resolveConfigPath,
    setConfigValue,
    unsetConfigValue,
    writeUserConfig,
} from '../user-config.js';

export interface ConfigFlags {
    json?: boolean;
    color?: boolean;
    dryRun?: boolean;
}

/**
 * Doc 09 § T6: every command that mutates something can be asked what it would
 * do first. `new` and `add` have their own richer plan output; these smaller
 * ones just report the change and return without making it.
 */
function reportDryRun(
    printer: Printer,
    change: { change: string; key: string; from: unknown; to: unknown; path: string }
): number {
    if (printer.options.json) printer.emitJson({ ok: true, dryRun: true, ...change });
    else {
        printer.line(`Would ${change.change} ${change.key} in ${change.path}`);
        printer.line(`  ${JSON.stringify(change.from)} → ${JSON.stringify(change.to)}`);
        printer.line('Nothing was written (--dry-run).');
    }
    return EXIT.OK;
}

export async function runConfig(
    action: string | undefined,
    args: string[],
    flags: ConfigFlags
): Promise<number> {
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });
    const path = resolveConfigPath();

    try {
        switch (action) {
            case 'path': {
                if (printer.options.json) printer.emitJson({ ok: true, path });
                else printer.line(path);
                return EXIT.OK;
            }

            case 'list': {
                const config = await readUserConfig(path);
                if (printer.options.json) {
                    printer.emitJson({ ok: true, config });
                } else {
                    for (const [key, value] of flattenConfig(config)) {
                        printer.line(`${key} = ${JSON.stringify(value)}`);
                    }
                }
                return EXIT.OK;
            }

            case 'get': {
                const [key] = args;
                if (!key) throw new CliUsageError('atarashi config get <key>');
                const config = await readUserConfig(path);
                const value = getConfigValue(config, key);
                if (printer.options.json) printer.emitJson({ ok: true, key, value: value ?? null });
                else printer.line(value === undefined ? '' : JSON.stringify(value));
                return EXIT.OK;
            }

            case 'set': {
                const [key, value] = args;
                if (!key || value === undefined)
                    throw new CliUsageError('atarashi config set <key> <value>');
                const config = await readUserConfig(path);
                const next = setConfigValue(config, key, value);
                const was = getConfigValue(config, key);
                const now = getConfigValue(next, key);

                if (flags.dryRun) {
                    return reportDryRun(printer, {
                        change: 'set',
                        key,
                        from: was ?? null,
                        to: now ?? null,
                        path,
                    });
                }

                await writeUserConfig(next, path);
                if (printer.options.json) printer.emitJson({ ok: true, key, value: now });
                else printer.success(`${key} = ${JSON.stringify(now)}`);
                return EXIT.OK;
            }

            case 'unset': {
                const [key] = args;
                if (!key) throw new CliUsageError('atarashi config unset <key>');
                const config = await readUserConfig(path);
                const next = unsetConfigValue(config, key);

                if (flags.dryRun) {
                    return reportDryRun(printer, {
                        change: 'unset',
                        key,
                        from: getConfigValue(config, key) ?? null,
                        to: null,
                        path,
                    });
                }

                await writeUserConfig(next, path);
                if (printer.options.json) printer.emitJson({ ok: true, key });
                else printer.success(`Unset ${key}`);
                return EXIT.OK;
            }

            default:
                throw new CliUsageError(
                    `Unknown \`atarashi config\` subcommand "${action ?? ''}"`,
                    ['atarashi config get|set|unset|list|path']
                );
        }
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
