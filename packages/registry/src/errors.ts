import { DIAGNOSTIC_CODES, type Diagnostic, error } from '@atarashi/schema';

/**
 * Every failure that crosses the registry boundary. Carries a
 * `DIAGNOSTIC_CODES` value so the CLI can map it to an exit code (6 for every
 * registry failure, per doc 04) and the web builder to a UI affordance.
 */
export class RegistryError extends Error {
    readonly code: string;
    readonly suggestions: string[];
    readonly detail: string | undefined;

    constructor(
        code: string,
        message: string,
        options: { suggestions?: string[]; detail?: string; cause?: unknown } = {}
    ) {
        super(message, options.cause === undefined ? undefined : { cause: options.cause });
        this.name = 'RegistryError';
        this.code = code;
        this.suggestions = options.suggestions ?? [];
        this.detail = options.detail;
    }

    toDiagnostic(): Diagnostic {
        const rest: Omit<Diagnostic, 'severity' | 'code' | 'message'> = {};
        if (this.suggestions.length > 0) rest.suggestions = this.suggestions;
        if (this.detail) rest.detail = this.detail;
        return error(this.code, this.message, rest);
    }
}

export const unavailable = (message: string, suggestions: string[] = []): RegistryError =>
    new RegistryError(DIAGNOSTIC_CODES.REGISTRY_UNAVAILABLE, message, { suggestions });

export const integrityFailure = (message: string, detail?: string): RegistryError =>
    new RegistryError(DIAGNOSTIC_CODES.INTEGRITY_MISMATCH, message, {
        detail,
        suggestions: [
            'Run `atarashi registry clear` and retry — a corrupt cache entry is the usual cause',
            'If it reproduces, the artifact has been tampered with: do not use it, and report it',
        ],
    });
