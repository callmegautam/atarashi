import { existsSync } from 'node:fs';
import { cp, mkdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LOCAL_BLUEPRINTS_DIR } from '@atarashi/registry';
import { parseProjectConfig } from '@atarashi/schema';
import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';
import { buildRegistry } from '../registry-context.js';
import { readUserConfig, resolveConfigPath } from '../user-config.js';
import { clack } from '../wizard.js';

export interface EjectFlags {
    dryRun?: boolean;
    yes?: boolean;
    json?: boolean;
    color?: boolean;
}

/**
 * Copies every resolved blueprint's raw template directory into
 * `./.atarashi/blueprints/`. The local loader already wins over every other
 * source by id (doc 05), so nothing in `atarashi.json` needs to change —
 * regeneration just starts reading the copies instead.
 */
export async function runEject(flags: EjectFlags): Promise<number> {
    const cwd = process.cwd();
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });

    try {
        const configPath = join(cwd, 'atarashi.json');
        if (!existsSync(configPath)) {
            throw new CliUsageError('No `atarashi.json` in this directory');
        }
        const configResult = parseProjectConfig(
            JSON.parse(await readFile(configPath, 'utf8')),
            configPath
        );
        if (!configResult.ok) throw configResult.error;
        const config = configResult.value;

        const interactive =
            Boolean(process.stdout.isTTY) && !flags.yes && !flags.json && !flags.dryRun;
        if (interactive) {
            const confirmed = await clack.confirm({
                message: `Copy ${config.blueprints.length} blueprint(s) into .atarashi/blueprints/? This is one-way.`,
                initialValue: false,
            });
            if (clack.isCancel(confirmed) || !confirmed) {
                printer.line('Cancelled.');
                return EXIT.OK;
            }
        }

        const userConfig = await readUserConfig(resolveConfigPath());
        const registry = buildRegistry({ cwd }, userConfig);
        const destRoot = join(cwd, LOCAL_BLUEPRINTS_DIR);

        const copied: string[] = [];
        const skipped: string[] = [];

        for (const blueprint of config.blueprints) {
            const loaded = await registry.load(blueprint.id);
            if (!loaded?.dir) {
                skipped.push(blueprint.id);
                continue;
            }
            copied.push(blueprint.id);
            // Doc 09 § T6: resolve everything, then stop short of the copy.
            if (flags.dryRun) continue;

            const dest = join(destRoot, blueprint.id);
            await mkdir(dest, { recursive: true });
            await cp(loaded.dir, dest, { recursive: true });
        }

        if (flags.dryRun) {
            if (printer.options.json) {
                printer.emitJson({ ok: true, dryRun: true, copied, skipped, dir: destRoot });
            } else {
                printer.line(`Would copy ${copied.length} blueprint(s) into ${destRoot}:`);
                for (const id of copied) printer.line(`  + ${id}`);
                for (const id of skipped) printer.line(`  · ${id} (no local directory)`);
                printer.line('Nothing was written (--dry-run).');
            }
            return EXIT.OK;
        }

        if (printer.options.json) {
            printer.emitJson({ ok: true, copied, skipped, dir: destRoot });
        } else {
            printer.success(`Ejected ${copied.length} blueprint(s) into ${destRoot}`);
            for (const id of skipped) printer.warn(`${id}: no on-disk source, skipped`);
        }
        return EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
