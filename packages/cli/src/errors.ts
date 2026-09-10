import { AtarashiError } from '@atarashi/schema';
import { EXIT, exitCodeFor } from './exit-codes.js';
import { type Printer, printDiagnostics } from './output.js';

/** A bad invocation — unknown flag, missing required answer, bad combination. */
export class CliUsageError extends Error {
    readonly suggestions: string[];

    constructor(message: string, suggestions: string[] = []) {
        super(message);
        this.name = 'CliUsageError';
        this.suggestions = suggestions;
    }
}

/** Prints whatever went wrong and returns the exit code the process should use. */
export function reportError(printer: Printer, thrown: unknown): number {
    if (thrown instanceof AtarashiError) {
        if (printer.options.json) {
            printer.emitJson({ ok: false, error: thrown.toJSON() });
        } else {
            // The thrown message is a summary of the first error diagnostic, so
            // printing both says the same thing twice in two different wordings.
            // The diagnostics win: they carry the counts, the blueprint names
            // and the suggestions. Only when none of them is an error does the
            // summary have something to add.
            if (!thrown.diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
                printer.error(thrown.message);
            }
            printDiagnostics(printer, thrown.diagnostics);
        }
        return exitCodeFor(thrown.code);
    }

    if (thrown instanceof CliUsageError) {
        if (printer.options.json) {
            printer.emitJson({
                ok: false,
                error: { code: 'ATA_CLI_USAGE', message: thrown.message },
            });
        } else {
            printer.error(thrown.message);
            for (const suggestion of thrown.suggestions) printer.detail(suggestion);
        }
        return EXIT.USAGE;
    }

    const message = thrown instanceof Error ? thrown.message : String(thrown);
    if (printer.options.json) {
        printer.emitJson({ ok: false, error: { code: 'ATA_UNEXPECTED', message } });
    } else {
        printer.error(message);
    }
    return EXIT.RUNTIME;
}
