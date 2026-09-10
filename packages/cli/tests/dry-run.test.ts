import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { runConfig } from '../src/commands/config.js';
import { runPreset } from '../src/commands/preset.js';

const dirs: string[] = [];

const scratch = async (): Promise<string> => {
    const dir = await mkdtemp(join(tmpdir(), 'atarashi-dry-'));
    dirs.push(dir);
    return dir;
};

afterEach(async () => {
    while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
    delete process.env.ATARASHI_CONFIG_DIR;
});

const configPath = (dir: string) => join(dir, 'config.json');

const readConfig = async (dir: string): Promise<Record<string, unknown>> => {
    if (!existsSync(configPath(dir))) return {};
    return JSON.parse(await readFile(configPath(dir), 'utf8')) as Record<string, unknown>;
};

/**
 * Doc 09 § T6: a command that changes something can be asked what it would do,
 * and asking must change nothing. `new` and `add` are covered by the e2e
 * matrix; these are the smaller mutating commands. Must never be skipped.
 */
describe('T6 — --dry-run writes nothing (security boundary)', () => {
    it('config set leaves the file untouched', async () => {
        const dir = await scratch();
        process.env.ATARASHI_CONFIG_DIR = dir;
        await runConfig('set', ['packageManager', 'npm'], { quiet: true } as never);

        const before = await readConfig(dir);
        const code = await runConfig('set', ['packageManager', 'yarn'], {
            dryRun: true,
            json: true,
        });

        expect(code).toBe(0);
        expect(await readConfig(dir)).toEqual(before);
    });

    it('config unset leaves the file untouched', async () => {
        const dir = await scratch();
        process.env.ATARASHI_CONFIG_DIR = dir;
        await runConfig('set', ['packageManager', 'npm'], {} as never);

        const code = await runConfig('unset', ['packageManager'], { dryRun: true, json: true });

        expect(code).toBe(0);
        expect(await readConfig(dir)).toMatchObject({ packageManager: 'npm' });
    });

    it('config set does not create a config file that was not there', async () => {
        const dir = await scratch();
        process.env.ATARASHI_CONFIG_DIR = dir;

        await runConfig('set', ['packageManager', 'pnpm'], { dryRun: true, json: true });

        expect(existsSync(configPath(dir))).toBe(false);
    });

    it('preset save writes no preset file', async () => {
        const dir = await scratch();
        const project = await scratch();
        process.env.ATARASHI_CONFIG_DIR = dir;
        await writeFile(
            join(project, 'atarashi.json'),
            JSON.stringify({
                specVersion: 1,
                atarashiVersion: '1.0.0',
                generatedAt: new Date().toISOString(),
                name: 'app',
                blueprints: [{ id: 'core/node-ts', version: '1.0.0' }],
                answers: {},
                options: {},
            })
        );

        const code = await runPreset('save', ['my-stack'], {
            from: join(project, 'atarashi.json'),
            dryRun: true,
            json: true,
        });

        expect(code).toBe(0);
        expect(existsSync(join(dir, 'presets', 'my-stack.json'))).toBe(false);
    });

    it('preset delete leaves the preset in place', async () => {
        const dir = await scratch();
        const project = await scratch();
        process.env.ATARASHI_CONFIG_DIR = dir;
        await writeFile(
            join(project, 'atarashi.json'),
            JSON.stringify({
                specVersion: 1,
                atarashiVersion: '1.0.0',
                generatedAt: new Date().toISOString(),
                name: 'app',
                blueprints: [{ id: 'core/node-ts', version: '1.0.0' }],
                answers: {},
                options: {},
            })
        );
        await runPreset('save', ['my-stack'], { from: join(project, 'atarashi.json') });

        const code = await runPreset('delete', ['my-stack'], { dryRun: true, json: true });

        expect(code).toBe(0);
        expect(existsSync(join(dir, 'presets', 'my-stack.json'))).toBe(true);
    });
});
