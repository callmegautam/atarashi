#!/usr/bin/env node
// Cold-start budget from doc 08: `atarashi new --dry-run` must stay under 2 s.
// A scaffolder is judged on the first thing it does, and this is it — Node
// startup, module load, blueprint resolution and a full render, with nothing
// written. Results append to `bench/cold-start.json` so the number is tracked
// over time rather than only checked once.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'packages/cli/dist/cli.js');

const BUDGET_MS = 2000;
const RUNS = 10;
const WARMUP = 2;

if (!existsSync(cli)) {
    console.error(`No CLI build at ${cli}. Run \`pnpm build\` first.`);
    process.exit(1);
}

const scenarios = [
    { name: 'new --preset backend-ts', args: ['new', 'bench-app', '--preset', 'backend-ts'] },
    {
        name: 'new --preset fullstack-react',
        args: ['new', 'bench-app', '--preset', 'fullstack-react'],
    },
    { name: 'new core/node-ts', args: ['new', 'bench-app', '--add', 'core/node-ts'] },
];

const percentile = (sorted, p) =>
    sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))];

function time(args) {
    const started = process.hrtime.bigint();
    const result = spawnSync(process.execPath, [cli, ...args, '--yes', '--dry-run'], {
        cwd: tmpdir(),
        encoding: 'utf8',
    });
    const elapsed = Number(process.hrtime.bigint() - started) / 1e6;
    if (result.status !== 0) {
        throw new Error(`\`${args.join(' ')}\` exited ${result.status}\n${result.stderr ?? ''}`);
    }
    return elapsed;
}

const results = [];
let failed = 0;

for (const scenario of scenarios) {
    for (let run = 0; run < WARMUP; run += 1) time(scenario.args);

    const samples = [];
    for (let run = 0; run < RUNS; run += 1) samples.push(time(scenario.args));
    samples.sort((a, b) => a - b);

    const median = percentile(samples, 0.5);
    const p95 = percentile(samples, 0.95);
    const over = p95 > BUDGET_MS;
    if (over) failed += 1;

    results.push({ scenario: scenario.name, median, p95, min: samples[0] });
    console.log(
        `${over ? '✖' : '✔'} ${scenario.name.padEnd(30)} median ${median.toFixed(0).padStart(5)} ms   p95 ${p95.toFixed(0).padStart(5)} ms   (budget ${BUDGET_MS} ms)`
    );
}

const historyDir = join(root, 'bench');
const historyFile = join(historyDir, 'cold-start.json');
mkdirSync(historyDir, { recursive: true });
const history = existsSync(historyFile)
    ? JSON.parse(readFileSync(historyFile, 'utf8'))
    : { budgetMs: BUDGET_MS, runs: [] };
history.runs.push({
    at: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}-${process.arch}`,
    results,
});
// Only the recent history is useful, and an unbounded file makes for noisy diffs.
history.runs = history.runs.slice(-50);
writeFileSync(historyFile, `${JSON.stringify(history, null, 2)}\n`);

console.log(
    `\n${failed === 0 ? '✔' : '✖'} cold-start benchmark: ${failed} scenario(s) over budget`
);
process.exit(failed > 0 ? 1 : 0);
