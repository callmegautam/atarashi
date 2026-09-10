import type { Diagnostic } from '@atarashi/schema';
import pc from 'picocolors';

export interface OutputOptions {
    json: boolean;
    quiet: boolean;
    verbose: boolean;
    color: boolean;
}

/**
 * Everything the CLI prints goes through here so `--json` (stdout only, one
 * object) and `--quiet` (errors only) stay true no matter which command runs.
 */
export class Printer {
    constructor(readonly options: OutputOptions) {}

    private paint(fn: (text: string) => string, text: string): string {
        return this.options.color ? fn(text) : text;
    }

    /** A plain line of human-mode output. */
    line(message: string): void {
        if (this.options.json || this.options.quiet) return;
        process.stdout.write(`${message}\n`);
    }

    step(message: string): void {
        if (this.options.json || this.options.quiet) return;
        process.stdout.write(`${this.paint(pc.cyan, '◆')}  ${message}\n`);
    }

    success(message: string): void {
        if (this.options.json || this.options.quiet) return;
        process.stdout.write(`${this.paint(pc.green, '✔')} ${message}\n`);
    }

    warn(message: string): void {
        if (this.options.json) return;
        process.stderr.write(`${this.paint(pc.yellow, '⚠')} ${message}\n`);
    }

    error(message: string): void {
        if (this.options.json) return;
        process.stderr.write(`${this.paint(pc.red, '✖')} ${message}\n`);
    }

    detail(message: string): void {
        if (this.options.json || this.options.quiet) return;
        process.stderr.write(`    ${this.paint(pc.dim, '→')} ${message}\n`);
    }

    verboseLog(message: string): void {
        if (!this.options.verbose || this.options.json) return;
        process.stderr.write(`${this.paint(pc.dim, message)}\n`);
    }

    /** JSON mode's one object on stdout. Never call more than once per run. */
    emitJson(value: unknown): void {
        process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
    }
}

export function printDiagnostics(printer: Printer, diagnostics: Diagnostic[]): void {
    for (const diagnostic of diagnostics) {
        const head = diagnostic.path
            ? `${diagnostic.message} (${diagnostic.path})`
            : diagnostic.message;

        if (diagnostic.severity === 'error') printer.error(head);
        else if (diagnostic.severity === 'warning') printer.warn(head);
        else printer.line(`  ${head}`);

        for (const suggestion of diagnostic.suggestions ?? []) {
            printer.detail(suggestion);
        }
    }
}

export const bytes = (n: number): string => {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};
