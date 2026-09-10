import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parseUserConfig, type UserConfig } from '@atarashi/schema';
import { CliUsageError } from './errors.js';

/** XDG on Linux and macOS, `%APPDATA%` on Windows — doc 04 § `atarashi config`. */
export function resolveConfigPath(
    env: NodeJS.ProcessEnv = process.env,
    platform: NodeJS.Platform = process.platform
): string {
    const override = env.ATARASHI_CONFIG_DIR?.trim();
    if (override) return join(override, 'config.json');

    if (platform === 'win32') {
        const base = env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming');
        return join(base, 'atarashi', 'config.json');
    }
    if (platform === 'darwin') {
        return join(homedir(), 'Library', 'Application Support', 'atarashi', 'config.json');
    }
    const xdg = env.XDG_CONFIG_HOME?.trim();
    return join(xdg || join(homedir(), '.config'), 'atarashi', 'config.json');
}

export async function readUserConfig(path: string): Promise<UserConfig> {
    if (!existsSync(path)) return {};

    const raw = await readFile(path, 'utf8');
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch (thrown) {
        throw new CliUsageError(`${path} is not valid JSON: ${(thrown as Error).message}`);
    }

    const result = parseUserConfig(parsed, path);
    if (!result.ok) throw new CliUsageError(result.error.message);
    return result.value;
}

export async function writeUserConfig(config: UserConfig, path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
    await rename(temp, path);
}

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
    typeof value === 'object' && value !== null && !Array.isArray(value);

export function getConfigValue(config: UserConfig, path: string): unknown {
    return path
        .split('.')
        .reduce<unknown>(
            (value, key) => (isPlainObject(value) ? value[key] : undefined),
            config as PlainObject
        );
}

/** Flattens nested config into `key.path = value` lines for `atarashi config list`. */
export function flattenConfig(config: UserConfig, prefix = ''): [string, unknown][] {
    const entries: [string, unknown][] = [];
    for (const [key, value] of Object.entries(config as PlainObject)) {
        const path = prefix ? `${prefix}.${key}` : key;
        if (isPlainObject(value)) entries.push(...flattenConfig(value as UserConfig, path));
        else entries.push([path, value]);
    }
    return entries;
}

const coerce = (raw: string): unknown => {
    if (raw === 'true') return true;
    if (raw === 'false') return false;
    if (raw === 'null') return null;
    if (raw.trim() !== '' && !Number.isNaN(Number(raw))) return Number(raw);
    return raw;
};

function withPath(
    config: UserConfig,
    path: string,
    apply: (parent: PlainObject, key: string) => void
): UserConfig {
    const keys = path.split('.');
    if (keys.some((key) => key.length === 0)) {
        throw new CliUsageError(`Invalid config key \`${path}\``);
    }

    const next = structuredClone(config) as PlainObject;
    let cursor = next;
    for (const key of keys.slice(0, -1)) {
        const existing = cursor[key];
        if (existing === undefined) {
            cursor[key] = {};
        } else if (!isPlainObject(existing)) {
            throw new CliUsageError(`\`${key}\` in \`${path}\` is not an object`);
        }
        cursor = cursor[key] as PlainObject;
    }
    apply(cursor, keys[keys.length - 1]!);

    const result = parseUserConfig(next);
    if (!result.ok) throw new CliUsageError(result.error.message);
    return result.value;
}

export function setConfigValue(config: UserConfig, path: string, raw: string): UserConfig {
    return withPath(config, path, (parent, key) => {
        parent[key] = coerce(raw);
    });
}

export function unsetConfigValue(config: UserConfig, path: string): UserConfig {
    return withPath(config, path, (parent, key) => {
        delete parent[key];
    });
}
