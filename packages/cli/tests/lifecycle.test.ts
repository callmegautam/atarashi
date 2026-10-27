import { existsSync } from 'node:fs';
import { appendFile, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runNew } from '../src/commands/new.js';
import { runRemove } from '../src/commands/remove.js';
import { runStatus } from '../src/commands/status.js';
import { runUpdate } from '../src/commands/update.js';
import { EXIT } from '../src/exit-codes.js';

const require_ = createRequire(import.meta.url);
const bundledRoot = dirname(require_.resolve('@atarashi/blueprints/package.json'));

const STACK = ['core/node-ts', 'http/express', 'auth/jwt', 'meta/readme'];
const OLD_VERSION = '1.0.0-test.1';

let root: string;
let project: string;
const startDir = process.cwd();

// biome-ignore lint/suspicious/noExplicitAny: parsed command output, asserted field by field
async function captureJson(run: () => Promise<number>): Promise<{ code: number; out: any }> {
    let stdout = '';
    const spy = vi.spyOn(process.stdout, 'write').mockImplementation((chunk) => {
        stdout += String(chunk);
        return true;
    });
    const stderr = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
        const code = await run();
        return { code, out: stdout ? JSON.parse(stdout) : undefined };
    } finally {
        spy.mockRestore();
        stderr.mockRestore();
    }
}

const read = (path: string) => readFile(join(project, path), 'utf8');

async function readConfig(): Promise<{
    atarashiVersion: string;
    blueprints: { id: string; version: string }[];
    answers: Record<string, unknown>;
}> {
    return JSON.parse(await read('atarashi.json'));
}

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'atarashi-lifecycle-'));
    process.env.ATARASHI_CACHE_DIR = join(root, 'cache');
    process.env.ATARASHI_CONFIG_DIR = join(root, 'config');
    process.chdir(root);
    const created = await captureJson(() =>
        runNew('app', [], {
            add: STACK,
            yes: true,
            json: true,
            offline: true,
            install: false,
            git: false,
            format: false,
        } as never)
    );
    expect(created.code).toBe(EXIT.OK);
    project = join(root, 'app');
    process.chdir(project);
});

afterEach(async () => {
    process.chdir(startDir);
    delete process.env.ATARASHI_CACHE_DIR;
    delete process.env.ATARASHI_CONFIG_DIR;
    await rm(root, { recursive: true, force: true });
});

const lifecycleFlags = { yes: true, json: true, offline: true, install: false };

describe('atarashi status', () => {
    it('reports a fresh project as clean', async () => {
        const { code, out } = await captureJson(() => runStatus({ json: true, offline: true }));
        expect(code).toBe(EXIT.OK);
        expect(out).toMatchObject({ clean: true, exactBaseline: true, drift: [], update: [] });
    });

    it('lists edited and deleted generated files', async () => {
        await appendFile(join(project, 'src/app.ts'), '\nexport const mine = 1;\n');
        await rm(join(project, 'README.md'));

        const { out } = await captureJson(() => runStatus({ json: true, offline: true }));
        expect(out.drift).toEqual([
            { path: 'README.md', kind: 'missing' },
            { path: 'src/app.ts', kind: 'modified' },
        ]);
        expect(out.clean).toBe(false);
    });
});

describe('atarashi remove', () => {
    it('takes a blueprint out and keeps hand edits', async () => {
        const pkg = JSON.parse(await read('package.json'));
        pkg.dependencies.lodash = '^4.17.21';
        await writeFile(join(project, 'package.json'), `${JSON.stringify(pkg, null, 2)}\n`);
        await appendFile(join(project, 'src/app.ts'), '\nexport const mine = 1;\n');

        const { code, out } = await captureJson(() => runRemove(['auth/jwt'], lifecycleFlags));

        expect(code).toBe(EXIT.OK);
        expect(out.removed).toEqual(['auth/jwt']);
        const after = JSON.parse(await read('package.json'));
        expect(after.dependencies.jsonwebtoken).toBeUndefined();
        expect(after.dependencies.lodash).toBe('^4.17.21');
        expect(await read('src/app.ts')).toContain('export const mine = 1;');
        expect(existsSync(join(project, 'src/lib/jwt.ts'))).toBe(false);

        const config = await readConfig();
        expect(config.blueprints.map((blueprint) => blueprint.id)).not.toContain('auth/jwt');
        expect(Object.keys(config.answers).some((name) => name.startsWith('auth.'))).toBe(false);

        const status = await captureJson(() => runStatus({ json: true, offline: true }));
        expect(status.out.drift.map((entry: { path: string }) => entry.path)).toEqual([
            'package.json',
            'src/app.ts',
        ]);
    });

    it('keeps an edited file that is no longer generated and says so', async () => {
        await appendFile(join(project, 'src/lib/jwt.ts'), '\n// mine\n');

        const { code, out } = await captureJson(() => runRemove(['auth/jwt'], lifecycleFlags));

        expect(code).toBe(EXIT.MERGE_CONFLICT);
        expect(out.skipped.map((entry: { path: string }) => entry.path)).toEqual([
            'src/lib/jwt.ts',
        ]);
        expect(await read('src/lib/jwt.ts')).toContain('// mine');
    });

    it('refuses to remove what another blueprint still needs', async () => {
        const before = await read('atarashi.json');
        const { code, out } = await captureJson(() => runRemove(['http/express'], lifecycleFlags));

        expect(code).toBe(EXIT.RESOLUTION);
        expect(out.error.diagnostics[0].message).toContain('only http/express provides');
        expect(await read('atarashi.json')).toBe(before);
    });

    it('refuses an id the project does not have', async () => {
        const { code } = await captureJson(() => runRemove(['db/postgres'], lifecycleFlags));
        expect(code).toBe(EXIT.USAGE);
    });

    it('writes nothing on a dry run', async () => {
        const before = await read('package.json');
        const { code, out } = await captureJson(() =>
            runRemove(['auth/jwt'], { ...lifecycleFlags, dryRun: true })
        );

        expect(code).toBe(EXIT.OK);
        expect(out.dryRun).toBe(true);
        expect(out.changes.length).toBeGreaterThan(0);
        expect(await read('package.json')).toBe(before);
        expect(existsSync(join(project, 'src/lib/jwt.ts'))).toBe(true);
    });
});

/**
 * Stands in for an older release: its blueprints are the bundled ones with
 * `meta/readme` one version behind and rendering one extra line, cached where
 * the baseline loader looks before it would go to npm.
 */
async function pretendGeneratedByOlderRelease(): Promise<void> {
    const baselines = join(root, 'cache', 'baselines');
    const older = join(baselines, 'blueprints-0.9.9');
    await mkdir(older, { recursive: true });
    for (const entry of ['blueprints', 'presets', 'version-manifest.json', 'package.json']) {
        await cp(join(bundledRoot, entry), join(older, entry), { recursive: true });
    }
    const manifestPath = join(older, 'blueprints/meta/readme/blueprint.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.version = '0.9.0';
    await writeFile(manifestPath, JSON.stringify(manifest, null, 2));
    await appendFile(join(older, 'blueprints/meta/readme/files/README.md.hbs'), '\nOLD LINE\n');
    await writeFile(
        join(baselines, `atarashi-${OLD_VERSION}.json`),
        JSON.stringify({ blueprints: '0.9.9' })
    );

    const config = JSON.parse(await read('atarashi.json'));
    config.atarashiVersion = OLD_VERSION;
    for (const blueprint of config.blueprints) {
        if (blueprint.id === 'meta/readme') blueprint.version = '0.9.0';
    }
    await writeFile(join(project, 'atarashi.json'), `${JSON.stringify(config, null, 2)}\n`);
    await appendFile(join(project, 'README.md'), '\nOLD LINE\n');
}

describe('atarashi update', () => {
    it('is a no-op on a project generated by this version', async () => {
        const { code, out } = await captureJson(() => runUpdate(lifecycleFlags));
        expect(code).toBe(EXIT.OK);
        expect(out).toMatchObject({ upToDate: true });
    });

    it('re-applies a newer blueprint version through a hand edit', async () => {
        await pretendGeneratedByOlderRelease();
        const readme = await read('README.md');
        await writeFile(join(project, 'README.md'), readme.replace(/^# .*$/m, '# my title'));

        const status = await captureJson(() => runStatus({ json: true, offline: true }));
        expect(status.out.versions).toEqual([{ id: 'meta/readme', from: '0.9.0', to: '1.0.0' }]);
        expect(status.out.update).toEqual([{ path: 'README.md', kind: 'merge' }]);

        const { code, out } = await captureJson(() => runUpdate(lifecycleFlags));

        expect(code).toBe(EXIT.OK);
        expect(out.written).toContainEqual({ path: 'README.md', kind: 'merge' });
        const after = await read('README.md');
        expect(after).toContain('# my title');
        expect(after).not.toContain('OLD LINE');

        const config = await readConfig();
        expect(config.atarashiVersion).not.toBe(OLD_VERSION);
        expect(config.blueprints.find((entry) => entry.id === 'meta/readme')?.version).toBe(
            '1.0.0'
        );

        const again = await captureJson(() => runUpdate(lifecycleFlags));
        expect(again.out).toMatchObject({ upToDate: true });
    });

    it('leaves an overlapping edit alone and exits with a conflict', async () => {
        await pretendGeneratedByOlderRelease();
        const readme = await read('README.md');
        await writeFile(join(project, 'README.md'), readme.replace('OLD LINE', 'MY LINE'));

        const { code, out } = await captureJson(() => runUpdate(lifecycleFlags));

        expect(code).toBe(EXIT.MERGE_CONFLICT);
        expect(out.skipped.map((entry: { path: string }) => entry.path)).toEqual(['README.md']);
        expect(await read('README.md')).toContain('MY LINE');
    });

    it('fails clearly when the original blueprints are not available offline', async () => {
        const config = JSON.parse(await read('atarashi.json'));
        config.atarashiVersion = '1.0.0-test.2';
        await writeFile(join(project, 'atarashi.json'), JSON.stringify(config));

        const { code, out } = await captureJson(() => runUpdate(lifecycleFlags));
        expect(code).toBe(EXIT.REGISTRY);
        expect(out.error.message).toContain('1.0.0-test.2');

        const status = await captureJson(() => runStatus({ json: true, offline: true }));
        expect(status.code).toBe(EXIT.OK);
        expect(status.out.exactBaseline).toBe(false);
    });
});
