import type { PackageManager, ProjectOptions, UserConfig } from '@atarashi/schema';
import { detectPackageManager } from './package-manager.js';

export interface OptionFlags {
    pm?: PackageManager;
    install?: boolean;
    git?: boolean;
    commit?: boolean;
    format?: boolean;
    license?: string;
    authorName?: string;
    authorEmail?: string;
    authorUrl?: string;
    writeEnv?: boolean;
    force?: boolean;
}

const bool = (...values: (boolean | undefined)[]): boolean | undefined =>
    values.find((value) => value !== undefined);

/**
 * Precedence chain from doc 04 § `atarashi config`: CLI flags → env vars
 * (`ATARASHI_*`) → user config → built-in defaults. `--from` and a project's
 * own `atarashi.json` sit above this in the caller, which merges them in
 * before flags are applied.
 */
export function resolveProjectOptions(
    flags: OptionFlags,
    userConfig: UserConfig,
    cwd: string,
    env: NodeJS.ProcessEnv = process.env
): Partial<ProjectOptions> {
    const envPm = env.ATARASHI_PACKAGE_MANAGER;
    const packageManager =
        flags.pm ??
        (envPm && ['pnpm', 'npm', 'yarn', 'bun'].includes(envPm)
            ? (envPm as PackageManager)
            : undefined) ??
        userConfig.packageManager ??
        detectPackageManager(cwd, env);

    const git = bool(
        flags.git,
        env.ATARASHI_GIT ? env.ATARASHI_GIT === 'true' : undefined,
        userConfig.git
    );
    const install = bool(
        flags.install,
        env.ATARASHI_INSTALL ? env.ATARASHI_INSTALL === 'true' : undefined,
        userConfig.install
    );
    const format = bool(flags.format, undefined, userConfig.format);
    const initialCommit = bool(flags.commit, undefined, userConfig.initialCommit);

    const license = flags.license ?? env.ATARASHI_LICENSE ?? userConfig.license ?? undefined;

    const authorName = flags.authorName ?? env.ATARASHI_AUTHOR_NAME ?? userConfig.author?.name;
    const authorEmail = flags.authorEmail ?? env.ATARASHI_AUTHOR_EMAIL ?? userConfig.author?.email;
    const authorUrl = flags.authorUrl ?? env.ATARASHI_AUTHOR_URL ?? userConfig.author?.url;
    const author =
        authorName || authorEmail || authorUrl
            ? { name: authorName, email: authorEmail, url: authorUrl }
            : undefined;

    const options: Partial<ProjectOptions> = { packageManager };
    if (git !== undefined) options.git = git;
    if (install !== undefined) options.install = install;
    if (format !== undefined) options.format = format;
    if (initialCommit !== undefined) options.initialCommit = initialCommit;
    if (license !== undefined) options.license = license;
    if (author !== undefined) options.author = author;
    if (flags.writeEnv !== undefined) options.writeEnv = flags.writeEnv;
    if (flags.force !== undefined) options.force = flags.force;

    return options;
}
