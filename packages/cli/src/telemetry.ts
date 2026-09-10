import { appendFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { resolveCacheRoot } from '@atarashi/registry';
import type { UserConfig } from '@atarashi/schema';

/**
 * Doc 09 § Telemetry: opt-in, off by default, and never includes project
 * names or paths. `DO_NOT_TRACK=1` (https://consoledonottrack.com),
 * `ATARASHI_TELEMETRY=0` and `CI=true` each win over an opted-in config.
 *
 * There is no first-party collection endpoint wired into this build — an
 * unconfigured "phone home" is worse than none. Consent-gated events are
 * appended to a local, inspectable NDJSON file instead; wiring a real,
 * owned collector is a deliberate follow-up, not a default this CLI assumes.
 */

/** Doc 09 § T7 lists three kill switches; each one wins over an opted-in config. */
const OFF = new Set(['1', 'true']);

export function telemetryEnabled(
    userConfig: UserConfig,
    env: NodeJS.ProcessEnv = process.env
): boolean {
    if (OFF.has(env.DO_NOT_TRACK ?? '')) return false;
    if (env.ATARASHI_TELEMETRY === '0' || env.ATARASHI_TELEMETRY === 'false') return false;
    // CI runs are not people, and a build agent cannot answer a consent prompt.
    if (OFF.has(env.CI ?? '')) return false;
    return userConfig.telemetry === true;
}

export interface TelemetryEvent {
    event: string;
    /** Free of project names, paths, or answers — counts and ids only. */
    properties?: Record<string, string | number | boolean>;
}

const eventsPath = () => join(resolveCacheRoot(), 'telemetry-events.ndjson');

export async function recordEvent(event: TelemetryEvent, userConfig: UserConfig): Promise<void> {
    if (!telemetryEnabled(userConfig)) return;
    const line = `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`;
    try {
        await mkdir(dirname(eventsPath()), { recursive: true });
        await appendFile(eventsPath(), line, 'utf8');
    } catch {
        // Telemetry never gets to fail a command.
    }
}
