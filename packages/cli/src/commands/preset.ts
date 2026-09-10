import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { parseProjectConfig } from '@atarashi/schema';
import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';
import { resolveConfigPath } from '../user-config.js';

export interface PresetFlags {
    from?: string;
    dryRun?: boolean;
    json?: boolean;
    color?: boolean;
}

interface PersonalPreset {
    name: string;
    blueprints: string[];
    answers: Record<string, unknown>;
}

const presetsDir = () => join(dirname(resolveConfigPath()), 'presets');
const presetPath = (name: string) => join(presetsDir(), `${name}.json`);

export async function runPreset(
    action: string | undefined,
    args: string[],
    flags: PresetFlags
): Promise<number> {
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });

    try {
        switch (action) {
            case 'save': {
                const [name] = args;
                if (!name) throw new CliUsageError('atarashi preset save <name>');

                const sourcePath = flags.from ?? join(process.cwd(), 'atarashi.json');
                if (!existsSync(sourcePath)) {
                    throw new CliUsageError(`No atarashi.json at ${sourcePath}`, [
                        'Run this from a generated project, or pass --from <path>',
                    ]);
                }
                const configResult = parseProjectConfig(
                    JSON.parse(await readFile(sourcePath, 'utf8')),
                    sourcePath
                );
                if (!configResult.ok) throw configResult.error;
                const config = configResult.value;

                const preset: PersonalPreset = {
                    name,
                    blueprints: config.blueprints.map((blueprint) => blueprint.id),
                    answers: config.answers,
                };

                if (flags.dryRun) {
                    if (printer.options.json)
                        printer.emitJson({
                            ok: true,
                            dryRun: true,
                            preset,
                            path: presetPath(name),
                        });
                    else {
                        printer.line(`Would save preset "${name}" to ${presetPath(name)}:`);
                        for (const id of preset.blueprints) printer.line(`  + ${id}`);
                        printer.line('Nothing was written (--dry-run).');
                    }
                    return EXIT.OK;
                }

                await mkdir(presetsDir(), { recursive: true });
                await writeFile(presetPath(name), `${JSON.stringify(preset, null, 2)}\n`, 'utf8');

                if (printer.options.json) printer.emitJson({ ok: true, preset });
                else
                    printer.success(
                        `Saved preset "${name}" (${preset.blueprints.length} blueprints)`
                    );
                return EXIT.OK;
            }

            case 'list': {
                const dir = presetsDir();
                const files = existsSync(dir)
                    ? (await readdir(dir)).filter((f) => f.endsWith('.json'))
                    : [];
                const presets: PersonalPreset[] = [];
                for (const file of files) {
                    presets.push(
                        JSON.parse(await readFile(join(dir, file), 'utf8')) as PersonalPreset
                    );
                }

                if (printer.options.json) printer.emitJson({ ok: true, presets });
                else if (presets.length === 0) printer.line('No personal presets saved yet.');
                else
                    for (const preset of presets)
                        printer.line(`${preset.name}  (${preset.blueprints.join(', ')})`);
                return EXIT.OK;
            }

            case 'delete': {
                const [name] = args;
                if (!name) throw new CliUsageError('atarashi preset delete <name>');
                const path = presetPath(name);
                if (!existsSync(path))
                    throw new CliUsageError(`No personal preset named "${name}"`);

                if (flags.dryRun) {
                    if (printer.options.json)
                        printer.emitJson({ ok: true, dryRun: true, name, path });
                    else {
                        printer.line(`Would delete ${path}`);
                        printer.line('Nothing was written (--dry-run).');
                    }
                    return EXIT.OK;
                }

                await rm(path);
                if (printer.options.json) printer.emitJson({ ok: true, name });
                else printer.success(`Deleted preset "${name}"`);
                return EXIT.OK;
            }

            default:
                throw new CliUsageError(
                    `Unknown \`atarashi preset\` subcommand "${action ?? ''}"`,
                    ['atarashi preset save|list|delete']
                );
        }
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
