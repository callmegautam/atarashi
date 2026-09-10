import { cliVersion } from '../engine.js';
import { reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';
import { fetchLatest } from '../update-notifier.js';

export interface UpgradeFlags {
    json?: boolean;
    color?: boolean;
}

export async function runUpgrade(flags: UpgradeFlags): Promise<number> {
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });

    try {
        const current = cliVersion();
        const latest = await fetchLatest();
        const upToDate = !latest || latest === current;

        if (printer.options.json) {
            printer.emitJson({ ok: true, current, latest: latest ?? null, upToDate });
            return EXIT.OK;
        }

        printer.line(`atarashi ${current}`);
        if (!latest) {
            printer.warn('Could not reach the npm registry to check for a newer version.');
        } else if (upToDate) {
            printer.success('Already on the latest version.');
        } else {
            printer.line(`A newer version is available: ${latest}`);
            printer.line('');
            printer.line('  npm install -g atarashi@latest');
            printer.line('  pnpm add -g atarashi@latest');
            printer.line('  bun add -g atarashi@latest');
        }
        return EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
