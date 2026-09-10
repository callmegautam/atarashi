import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';
import { buildRegistry } from '../registry-context.js';
import { readUserConfig, resolveConfigPath } from '../user-config.js';

export interface InfoFlags {
    json?: boolean;
    color?: boolean;
    offline?: boolean;
    registry?: string;
}

export async function runInfo(id: string | undefined, flags: InfoFlags): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });

    try {
        if (!id) throw new CliUsageError('Specify a blueprint id', ['atarashi info db/postgres']);

        const userConfig = await readUserConfig(resolveConfigPath());
        const registry = buildRegistry(
            { cwd, offline: flags.offline, registry: flags.registry },
            userConfig
        );
        const loaded = await registry.load(id);
        if (!loaded) throw new CliUsageError(`Unknown blueprint "${id}"`);
        const manifest = loaded.manifest;

        if (printer.options.json) {
            printer.emitJson({
                ok: true,
                manifest,
                origin: loaded.origin,
                trusted: loaded.trusted,
            });
            return EXIT.OK;
        }

        printer.line(`${manifest.name}  (${manifest.id}@${manifest.version})`);
        printer.line(manifest.description);
        printer.line(`category: ${manifest.category}  ·  source: ${loaded.origin}`);
        if (manifest.deprecated) {
            printer.warn(
                `deprecated since ${manifest.deprecated.since}${manifest.deprecated.use ? ` — use ${manifest.deprecated.use}` : ''}`
            );
        }
        if (manifest.experimental) printer.warn('experimental');
        printer.line('');

        if (manifest.provides.length) printer.line(`provides   ${manifest.provides.join(', ')}`);
        if (manifest.requires.length) printer.line(`requires   ${manifest.requires.join(', ')}`);
        if (manifest.conflicts.length) printer.line(`conflicts  ${manifest.conflicts.join(', ')}`);

        if (manifest.prompts.length > 0) {
            printer.line('');
            printer.line('prompts');
            for (const prompt of manifest.prompts) {
                const flag = prompt.flag ?? `--set ${prompt.name}=<value>`;
                const def =
                    prompt.default !== undefined
                        ? ` (default: ${JSON.stringify(prompt.default)})`
                        : '';
                printer.line(`  ${flag}`);
                printer.line(`    ${prompt.message}${def}`);
            }
        }

        const depNames = Object.keys(manifest.dependencies);
        const devDepNames = Object.keys(manifest.devDependencies);
        if (depNames.length > 0 || devDepNames.length > 0) {
            printer.line('');
            if (depNames.length > 0) printer.line(`dependencies      ${depNames.join(', ')}`);
            if (devDepNames.length > 0) printer.line(`devDependencies   ${devDepNames.join(', ')}`);
        }

        if (manifest.env.length > 0) {
            printer.line('');
            printer.line('env');
            for (const entry of manifest.env) {
                printer.line(
                    `  ${entry.key}${entry.required ? '' : ' (optional)'} — ${entry.description ?? ''}`
                );
            }
        }

        printer.line('');
        printer.line(`${manifest.files.length} file(s) contributed`);
        if (manifest.docs) printer.line(`docs: ${manifest.docs}`);

        return EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
