import type { Diagnostic } from './diagnostics.js';

/**
 * Core never throws for expected failures and never calls `process.exit`; it
 * returns one of these and lets the caller decide what an error means.
 */
export type Result<T> =
    | { ok: true; value: T; diagnostics: Diagnostic[] }
    | { ok: false; error: AtarashiError };

export class AtarashiError extends Error {
    readonly code: string;
    readonly diagnostics: Diagnostic[];

    constructor(code: string, message: string, diagnostics: Diagnostic[] = []) {
        super(message);
        this.name = 'AtarashiError';
        this.code = code;
        this.diagnostics = diagnostics;
    }

    /** Everything the CLI needs to print, and everything `--json` emits. */
    toJSON() {
        return { code: this.code, message: this.message, diagnostics: this.diagnostics };
    }
}

export const ok = <T>(value: T, diagnostics: Diagnostic[] = []): Result<T> => ({
    ok: true,
    value,
    diagnostics,
});

export const err = <T = never>(error: AtarashiError): Result<T> => ({ ok: false, error });

export const fail = <T = never>(
    code: string,
    message: string,
    diagnostics: Diagnostic[] = []
): Result<T> => err(new AtarashiError(code, message, diagnostics));

export function unwrap<T>(result: Result<T>): T {
    if (!result.ok) throw result.error;
    return result.value;
}
