import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveCacheRoot } from '@atarashi/registry';
import pc from 'picocolors';

interface NotifierState {
    lastCheck: string;
    latest?: string;
}

const statePath = () => join(resolveCacheRoot(), 'update-notifier.json');
const DAY_MS = 24 * 60 * 60 * 1000;

const isNewer = (candidate: string, current: string): boolean => {
    const a = candidate.split('.').map(Number);
    const b = current.split('.').map(Number);
    for (let index = 0; index < 3; index += 1) {
        const left = a[index] ?? 0;
        const right = b[index] ?? 0;
        if (left !== right) return left > right;
    }
    return false;
};

export async function fetchLatest(): Promise<string | undefined> {
    try {
        const response = await fetch('https://registry.npmjs.org/atarashi/latest', {
            signal: AbortSignal.timeout(2000),
        });
        if (!response.ok) return undefined;
        const data = (await response.json()) as { version?: string };
        return data.version;
    } catch {
        return undefined;
    }
}

/**
 * At most once a day, in the background — the caller sets `process.exitCode`
 * rather than calling `process.exit()`, so Node's event loop drains this
 * before the process actually ends without holding up the command's own
 * output. Silenced by `--quiet`, `CI=true`, or `updateNotifier: false`.
 */
export async function checkForUpdate(
    currentVersion: string,
    options: { enabled: boolean; env?: NodeJS.ProcessEnv }
): Promise<void> {
    if (!options.enabled) return;
    const env = options.env ?? process.env;
    if (env.CI === 'true' || env.CI === '1') return;

    const path = statePath();
    let state: NotifierState | undefined;
    try {
        if (existsSync(path)) state = JSON.parse(await readFile(path, 'utf8')) as NotifierState;
    } catch {
        state = undefined;
    }

    const stale = !state || Date.now() - new Date(state.lastCheck).getTime() > DAY_MS;
    if (stale) {
        const latest = await fetchLatest();
        state = { lastCheck: new Date().toISOString(), latest };
        try {
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, JSON.stringify(state), 'utf8');
        } catch {
            // Best effort — a cold cache just means we check again next time.
        }
    }

    if (state?.latest && isNewer(state.latest, currentVersion)) {
        process.stderr.write(
            `\n${pc.yellow('▲')} atarashi ${state.latest} is available (current: ${currentVersion})\n` +
                `  Run: npm install -g atarashi@latest\n`
        );
    }
}
