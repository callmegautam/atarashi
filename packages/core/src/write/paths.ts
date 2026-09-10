import { posix } from 'node:path';

export class PathSafetyError extends Error {
    readonly path: string;

    constructor(message: string, path: string) {
        super(message);
        this.name = 'PathSafetyError';
        this.path = path;
    }
}

/** Windows reserves these regardless of extension. A file named `aux.ts` is unopenable there. */
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\.|$)/i;

/** Characters Windows refuses outright. Rejected everywhere so output is portable. */
const WINDOWS_ILLEGAL = /[<>:"|?*]/;

/**
 * Normalizes a project-relative path to POSIX separators and rejects anything
 * that could write outside the target directory. This is a security boundary:
 * every path in the plan passes through here before it reaches the writer.
 */
export function normalizeProjectPath(input: string): string {
    if (input.length === 0) throw new PathSafetyError('Path is empty', input);
    if (input.includes('\0')) throw new PathSafetyError('Path contains a null byte', input);

    const unified = input.replace(/\\/g, '/');

    if (unified.startsWith('/')) {
        throw new PathSafetyError('Path must be project-relative, not absolute', input);
    }
    if (/^[a-zA-Z]:\//.test(unified)) {
        throw new PathSafetyError('Path must be project-relative, not a drive path', input);
    }
    if (unified.startsWith('~')) {
        throw new PathSafetyError('Path must not start with `~`', input);
    }

    const normalized = posix.normalize(unified).replace(/^\.\//, '').replace(/\/+$/, '');

    if (normalized === '' || normalized === '.') {
        throw new PathSafetyError('Path resolves to the project root', input);
    }
    // `normalize` collapses `a/../b`, so any `..` left over escapes the root.
    if (normalized === '..' || normalized.startsWith('../')) {
        throw new PathSafetyError('Path escapes the target directory', input);
    }

    for (const segment of normalized.split('/')) {
        if (WINDOWS_ILLEGAL.test(segment)) {
            throw new PathSafetyError(
                `Path segment \`${segment}\` contains a character Windows cannot write`,
                input
            );
        }
        if (WINDOWS_RESERVED.test(segment)) {
            throw new PathSafetyError(
                `Path segment \`${segment}\` is a reserved name on Windows`,
                input
            );
        }
        if (segment.endsWith(' ') || segment.endsWith('.')) {
            throw new PathSafetyError(
                `Path segment \`${segment}\` ends with a space or dot, which Windows strips`,
                input
            );
        }
    }

    return normalized;
}

/**
 * The key two paths collide under on a case-insensitive filesystem. Used to
 * catch `README.md` vs `readme.md` in the plan rather than on a user's Mac.
 */
export const caseKey = (path: string): string => path.toLowerCase();

/**
 * Blueprints ship dotfiles as `_gitignore` because npm strips leading dots from
 * published packages. Resolved at load time, per segment, so
 * `files/_github/workflows/ci.yml` becomes `.github/workflows/ci.yml`.
 */
export function resolveDotfileNames(path: string): string {
    return path
        .split('/')
        .map((segment) =>
            segment.startsWith('_') && segment.length > 1 ? `.${segment.slice(1)}` : segment
        )
        .join('/');
}

/** Sorts paths so directories group naturally and output is deterministic. */
export const comparePaths = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
