import { existsSync } from 'node:fs';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
    flattenConfig,
    getConfigValue,
    readUserConfig,
    resolveConfigPath,
    setConfigValue,
    unsetConfigValue,
    writeUserConfig,
} from '../src/user-config.js';

describe('resolveConfigPath', () => {
    it('respects ATARASHI_CONFIG_DIR on every platform', () => {
        const path = resolveConfigPath({ ATARASHI_CONFIG_DIR: '/custom/dir' }, 'linux');
        expect(path).toBe('/custom/dir/config.json');
    });

    it('falls back to XDG_CONFIG_HOME on linux', () => {
        const path = resolveConfigPath({ XDG_CONFIG_HOME: '/home/x/.config' }, 'linux');
        expect(path).toBe('/home/x/.config/atarashi/config.json');
    });

    it('uses %APPDATA% on windows', () => {
        // `path.join` follows the host OS, not the `platform` param, so this
        // only checks composition — the separator itself is exercised for
        // real whenever this actually runs on Windows.
        const path = resolveConfigPath({ APPDATA: 'C:\\Users\\x\\AppData\\Roaming' }, 'win32');
        expect(path.replace(/\\/g, '/')).toBe(
            'C:\\Users\\x\\AppData\\Roaming'.replace(/\\/g, '/') + '/atarashi/config.json'
        );
    });
});

describe('get/set/unset/flatten', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'atarashi-config-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    it('round-trips a nested value through set and get', () => {
        const next = setConfigValue({}, 'author.name', 'Ada Lovelace');
        expect(getConfigValue(next, 'author.name')).toBe('Ada Lovelace');
    });

    it('coerces booleans and numbers from raw strings', () => {
        let config = setConfigValue({}, 'git', 'true');
        config = setConfigValue(config, 'telemetry', 'false');
        expect(getConfigValue(config, 'git')).toBe(true);
        expect(getConfigValue(config, 'telemetry')).toBe(false);
    });

    it('unset removes a nested value without disturbing its siblings', () => {
        let config = setConfigValue({}, 'author.name', 'Ada');
        config = setConfigValue(config, 'author.email', 'ada@example.com');
        config = unsetConfigValue(config, 'author.name');
        expect(getConfigValue(config, 'author.name')).toBeUndefined();
        expect(getConfigValue(config, 'author.email')).toBe('ada@example.com');
    });

    it('flattens nested config into dotted keys', () => {
        const config = setConfigValue({}, 'author.name', 'Ada');
        expect(flattenConfig(config)).toEqual([['author.name', 'Ada']]);
    });

    it('reads back exactly what was written, and an absent file is an empty config', async () => {
        const path = join(dir, 'config.json');
        expect(existsSync(path)).toBe(false);
        expect(await readUserConfig(path)).toEqual({});

        await writeUserConfig({ packageManager: 'pnpm', telemetry: false }, path);
        expect(await readUserConfig(path)).toEqual({ packageManager: 'pnpm', telemetry: false });
    });
});
