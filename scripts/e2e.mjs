#!/usr/bin/env node
// The test that proves the product works (doc 08 §5): generate a project,
// install it, build it, lint it, test it, boot it, and hit its healthcheck.
// Everything a snapshot cannot tell you — whether the thing we generated is a
// project that actually runs — lives here.
//
//   node scripts/e2e.mjs                  representative matrix, no databases
//   node scripts/e2e.mjs --db             also boot the database-backed combos
//   node scripts/e2e.mjs --filter express only matching scenarios
//   node scripts/e2e.mjs --keep           leave the generated projects on disk
//
// Databases come from the generated `docker-compose.yml`, so this needs no CI
// service containers and runs the same on a laptop as anywhere else.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'packages/cli/dist/cli.js');

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const value = (name) => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
};

const WITH_DB = flag('--db');
const KEEP = flag('--keep');
const FILTER = value('--filter');
const BOOT_TIMEOUT_MS = 30_000;

/**
 * The representative subset from doc 08 — one row per axis that has ever
 * produced a bug: each HTTP framework, each ORM, both languages, a UI combo,
 * and a no-http library build.
 */
const MATRIX = [
    { name: 'backend-ts (postgres + drizzle)', preset: 'backend-ts', db: 'postgres' },
    { name: 'backend-minimal (no db)', preset: 'backend-minimal' },
    { name: 'backend-mongo', preset: 'backend-mongo', db: 'mongodb' },
    { name: 'fullstack-react', preset: 'fullstack-react', db: 'postgres' },
    { name: 'fullstack-angular', preset: 'fullstack-angular', db: 'postgres' },
    { name: 'frontend-only', preset: 'frontend-only', boot: false },
    {
        name: 'fastify + sqlite + drizzle',
        add: [
            'core/node-ts',
            'http/fastify',
            'db/sqlite',
            'orm/drizzle',
            'validation/zod',
            'test/vitest',
            'lint/biome',
        ],
    },
    {
        name: 'hono + mysql + prisma',
        add: ['core/node-ts', 'http/hono', 'db/mysql', 'orm/prisma', 'validation/zod'],
        db: 'mysql',
    },
    {
        name: 'express + js (no typescript)',
        add: ['core/node-js', 'http/express', 'mw/cors', 'mw/error-handler'],
    },
    {
        name: 'express + jwt auth + vitest',
        add: [
            'core/node-ts',
            'http/express',
            'auth/jwt',
            'validation/zod',
            'db/sqlite',
            'orm/drizzle',
            'test/vitest',
        ],
    },
];

const scenarios = MATRIX.filter(
    (scenario) => !FILTER || scenario.name.toLowerCase().includes(FILTER.toLowerCase())
);

const run = (command, args, options = {}) =>
    spawnSync(command, args, {
        encoding: 'utf8',
        // Windows resolves `pnpm` to `pnpm.cmd`, which needs a shell.
        shell: process.platform === 'win32',
        ...options,
    });

const step = (label, result) => {
    if (result.status === 0) {
        console.log(`    ✔ ${label}`);
        return true;
    }
    console.error(`    ✖ ${label} (exit ${result.status})`);
    const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.trimEnd();
    if (output)
        console.error(
            output
                .split('\n')
                .slice(-25)
                .map((l) => `      ${l}`)
                .join('\n')
        );
    return false;
};

const scriptsOf = (dir) => {
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    return manifest.scripts ?? {};
};

/** Polls the healthcheck until it answers or the budget runs out. */
async function waitForHealth(url, deadline, child) {
    while (Date.now() < deadline) {
        if (child.exitCode !== null) {
            throw new Error(`server exited early with code ${child.exitCode}`);
        }
        try {
            const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
            if (response.ok) return response.status;
        } catch {
            // Not listening yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
    }
    throw new Error(`no 200 from ${url} within ${BOOT_TIMEOUT_MS} ms`);
}

async function bootAndCheck(dir, env) {
    const port = 3000 + Math.floor(Math.random() * 20000);
    const child = spawn('pnpm', ['start'], {
        cwd: dir,
        env: { ...process.env, ...env, PORT: String(port), NODE_ENV: 'production' },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: process.platform === 'win32',
        // Its own group, so a server that spawns children still dies with it.
        detached: process.platform !== 'win32',
    });

    let output = '';
    child.stdout.on('data', (chunk) => {
        output += chunk;
    });
    child.stderr.on('data', (chunk) => {
        output += chunk;
    });

    try {
        await waitForHealth(`http://127.0.0.1:${port}/health`, Date.now() + BOOT_TIMEOUT_MS, child);
        console.log('    ✔ boot + GET /health → 200');
        return true;
    } catch (cause) {
        console.error(`    ✖ boot + healthcheck: ${cause.message}`);
        console.error(
            output
                .split('\n')
                .slice(-25)
                .map((l) => `      ${l}`)
                .join('\n')
        );
        return false;
    } finally {
        killTree(child);
        // A server left holding the port would break every later scenario.
        await new Promise((resolve) => setTimeout(resolve, 250));
        if (child.exitCode === null && child.signalCode === null) {
            console.error('    ✖ server did not shut down — orphaned process');
        }
    }
}

function killTree(child) {
    if (child.pid === undefined || child.exitCode !== null) return;
    try {
        if (process.platform === 'win32') run('taskkill', ['/pid', String(child.pid), '/t', '/f']);
        else process.kill(-child.pid, 'SIGTERM');
    } catch {
        // Already gone.
    }
}

function composeUp(dir) {
    const result = run('docker', ['compose', 'up', '-d', '--wait'], { cwd: dir });
    return step('docker compose up', result);
}

function composeDown(dir) {
    run('docker', ['compose', 'down', '-v'], { cwd: dir });
}

const dockerAvailable = () => run('docker', ['--version']).status === 0;

async function runScenario(scenario) {
    console.log(`\n── ${scenario.name}`);
    const workspace = mkdtempSync(join(tmpdir(), 'atarashi-e2e-'));
    const dir = join(workspace, 'app');
    const usesDb = Boolean(scenario.db);
    const wantsBoot = scenario.boot !== false;

    try {
        // `--write-env` gives the generated config the sample values it
        // validates against, which is what a real first run does.
        const args = [
            'new',
            'app',
            '--yes',
            '--pm',
            'pnpm',
            '--no-install',
            '--no-git',
            '--write-env',
        ];
        if (scenario.preset) args.push('--preset', scenario.preset);
        for (const id of scenario.add ?? []) args.push('--add', id);
        if (usesDb) args.push('--add', 'infra/docker-compose');

        if (!step('generate', run(process.execPath, [cli, ...args], { cwd: workspace }))) {
            return false;
        }
        if (!existsSync(dir)) {
            console.error('    ✖ generate produced no `app` directory');
            return false;
        }

        // No build-approval escape hatch: a generated project declares the
        // dependencies it needs built in `pnpm-workspace.yaml`, so a plain
        // install is exactly what a real user runs.
        const install = run('pnpm', ['install'], { cwd: dir });
        if (!step('install', install)) return false;

        const scripts = scriptsOf(dir);
        // The CLI's post-actions run install then format, so a real project is
        // formatted before anything lints it. We skipped the CLI's install to
        // control the flags, so the format step belongs here.
        if (scripts.format && !step('format', run('pnpm', ['format'], { cwd: dir }))) return false;
        if (scripts.build && !step('build', run('pnpm', ['build'], { cwd: dir }))) return false;
        if (scripts.lint && !step('lint', run('pnpm', ['lint'], { cwd: dir }))) return false;
        if (scripts.test && !step('test', run('pnpm', ['test'], { cwd: dir }))) return false;

        if (!scripts.start || !wantsBoot) {
            console.log('    – boot skipped (no start script)');
            return true;
        }
        if (usesDb && !WITH_DB) {
            console.log(`    – boot skipped (needs ${scenario.db}; pass --db)`);
            return true;
        }
        if (usesDb && !composeUp(dir)) return false;

        try {
            return await bootAndCheck(dir, {});
        } finally {
            if (usesDb) composeDown(dir);
        }
    } finally {
        if (KEEP) console.log(`    kept at ${dir}`);
        else rmSync(workspace, { recursive: true, force: true });
    }
}

if (!existsSync(cli)) {
    console.error(`No CLI build at ${cli}. Run \`pnpm build\` first.`);
    process.exit(1);
}
if (WITH_DB && !dockerAvailable()) {
    console.error('`--db` needs a working `docker compose`.');
    process.exit(1);
}

const failures = [];
for (const scenario of scenarios) {
    if (!(await runScenario(scenario))) failures.push(scenario.name);
}

console.log(
    `\n${failures.length === 0 ? '✔' : '✖'} e2e: ${scenarios.length - failures.length}/${scenarios.length} scenarios passed`
);
for (const name of failures) console.log(`  ✖ ${name}`);
process.exit(failures.length > 0 ? 1 : 0);
