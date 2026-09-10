import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { PackageManager } from '@atarashi/schema';

const LOCKFILES: [string, PackageManager][] = [
    ['pnpm-lock.yaml', 'pnpm'],
    ['bun.lock', 'bun'],
    ['bun.lockb', 'bun'],
    ['yarn.lock', 'yarn'],
    ['package-lock.json', 'npm'],
];

const KNOWN = new Set<string>(['pnpm', 'npm', 'yarn', 'bun']);

/**
 * `npm_config_user_agent` is set by every major package manager when they run
 * a script or `create`/`dlx` command — the same signal npm's own `create-*`
 * tooling uses. A lockfile in the target's parent chain is the fallback for a
 * plain `npx atarashi`, where the variable names npm itself.
 */
export function detectPackageManager(
    cwd: string,
    env: NodeJS.ProcessEnv = process.env
): PackageManager {
    const agent = env.npm_config_user_agent;
    if (agent) {
        const name = agent.split('/')[0]?.trim();
        if (name && KNOWN.has(name)) return name as PackageManager;
    }

    for (const [file, pm] of LOCKFILES) {
        if (existsSync(join(cwd, file))) return pm;
    }

    return 'pnpm';
}
