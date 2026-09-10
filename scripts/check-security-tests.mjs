#!/usr/bin/env node
// Doc 09 § Process: "security-relevant tests are marked and can never be
// skipped". A rule nothing checks is a rule that decays, so this is the check.
//
// Every threat in the threat model must have at least one `describe` block
// marked `(security boundary)`, and no such block — nor any test inside one —
// may be skipped, todo'd, or narrowed to `.only` (which silently drops its
// siblings from the run).
//
//   node scripts/check-security-tests.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

/** Every threat doc 09 defines, and where its boundary tests live. */
const THREATS = {
    T1: 'path traversal',
    T2: 'hook sandbox',
    T3: 'install scripts',
    T4: 'registry integrity',
    T5: 'secret leakage',
    T6: 'destructive writes',
    T7: 'telemetry',
};

const MARKER = '(security boundary)';

function testFiles(dir) {
    const found = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '.git') {
            continue;
        }
        const full = join(dir, entry.name);
        if (entry.isDirectory()) found.push(...testFiles(full));
        else if (/\.test\.ts$/.test(entry.name)) found.push(full);
    }
    return found;
}

const files = statSync(join(root, 'packages')).isDirectory()
    ? testFiles(join(root, 'packages'))
    : [];

const problems = [];
const covered = new Set();

for (const file of files) {
    const source = readFileSync(file, 'utf8');
    const relative = file.slice(root.length);

    const lines = source.split('\n');
    lines.forEach((line, index) => {
        if (!line.includes(MARKER)) return;

        // A block can cover more than one threat, e.g. "T3/T5 — the catalogue".
        for (const threat of line.matchAll(/\bT([1-7])\b/g)) covered.add(`T${threat[1]}`);

        if (/describe\s*\.\s*(skip|todo|only)/.test(line)) {
            problems.push(
                `${relative}:${index + 1} — a security-boundary block is ${/only/.test(line) ? 'narrowed with .only' : 'skipped'}`
            );
        }

        // Scan the block's body for skipped cases, to the next top-level
        // `describe(` or the end of the file.
        for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
            const body = lines[cursor];
            if (/^describe[.(]/.test(body)) break;
            if (/\b(it|test)\s*\.\s*(skip|todo|only)/.test(body)) {
                problems.push(
                    `${relative}:${cursor + 1} — a test inside a security-boundary block is ${/only/.test(body) ? 'narrowed with .only' : 'skipped'}`
                );
            }
        }
    });
}

for (const [threat, what] of Object.entries(THREATS)) {
    if (!covered.has(threat)) {
        problems.push(`${threat} (${what}) has no test marked "${MARKER}"`);
    }
}

if (problems.length > 0) {
    console.error(`✖ security test check failed (${problems.length}):`);
    for (const problem of problems) console.error(`    ${problem}`);
    process.exit(1);
}

console.log(
    `✔ all ${Object.keys(THREATS).length} threats have unskippable boundary tests, across ${files.length} test files`
);
