#!/usr/bin/env node
// Every quality gate from doc 08, in one command, in dependency order. This is
// what runs before `changeset version && changeset publish` — nothing runs on
// GitHub, so the gate is the thing a human runs locally and reads.
//
//   pnpm release:check            everything except the database-backed e2e
//   pnpm release:check --db       including those (needs docker compose)
//   pnpm release:check --skip e2e skip a gate by name
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const argv = process.argv.slice(2);
const skipped = new Set(argv.flatMap((arg, index) => (argv[index - 1] === '--skip' ? [arg] : [])));
const withDb = argv.includes('--db');

const gates = [
    { name: 'typecheck', command: 'pnpm', args: ['typecheck'] },
    { name: 'lint', command: 'pnpm', args: ['lint'] },
    { name: 'build', command: 'pnpm', args: ['build'] },
    { name: 'test', command: 'pnpm', args: ['test'] },
    // Doc 09 § Process: the threat model's tests exist and none is skipped.
    { name: 'security', command: 'pnpm', args: ['check:security'] },
    { name: 'blueprints', command: 'pnpm', args: ['validate:blueprints'] },
    // The generated docs are built from the binary, the manifests and real
    // plans, so a stale one means the docs describe a version that no longer
    // exists. Runs after `build`, since it invokes the built CLI.
    { name: 'docs', command: 'pnpm', args: ['check:docs'] },
    { name: 'packaging', command: 'pnpm', args: ['check:packaging'] },
    { name: 'bench', command: 'pnpm', args: ['bench'] },
    { name: 'e2e', command: 'pnpm', args: withDb ? ['e2e', '--db'] : ['e2e'] },
];

const results = [];
for (const gate of gates) {
    if (skipped.has(gate.name)) {
        results.push({ name: gate.name, status: 'skipped' });
        console.log(`\n▸ ${gate.name} — skipped`);
        continue;
    }

    console.log(`\n▸ ${gate.name}`);
    const started = Date.now();
    const result = spawnSync(gate.command, gate.args, {
        cwd: root,
        stdio: 'inherit',
        shell: process.platform === 'win32',
    });
    results.push({
        name: gate.name,
        status: result.status === 0 ? 'pass' : 'fail',
        seconds: (Date.now() - started) / 1000,
    });
}

console.log(`\n${'─'.repeat(50)}`);
for (const result of results) {
    const mark = result.status === 'pass' ? '✔' : result.status === 'fail' ? '✖' : '–';
    const timing = result.seconds ? ` ${result.seconds.toFixed(1)}s` : '';
    console.log(`${mark} ${result.name}${timing}`);
}

const failed = results.filter((result) => result.status === 'fail');
if (failed.length > 0) {
    console.log(`\n✖ ${failed.length} gate(s) failed — not ready to publish`);
    process.exit(1);
}
if (results.some((result) => result.status === 'skipped')) {
    console.log('\n⚠ all run gates passed, but some were skipped');
    process.exit(0);
}
console.log('\n✔ all gates passed — `pnpm changeset version` then `pnpm release`');
