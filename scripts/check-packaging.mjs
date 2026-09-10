#!/usr/bin/env node
// `publint` + `are-the-types-wrong` over every publishable package, plus the
// unpacked-size budget from doc 08. Run before cutting a release: these catch
// the packaging mistakes that only show up once someone has installed the
// thing — wrong `exports`, missing `types`, an ESM/CJS mismatch, a dist that
// quietly grew a copy of its own sourcemaps.
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const packagesDir = join(root, 'packages');

/** doc 08: the published `atarashi` package must stay under 2 MB unpacked. */
const SIZE_BUDGETS = { atarashi: 2 * 1024 * 1024 };
const DEFAULT_BUDGET = 2 * 1024 * 1024;

const run = (command, args, cwd) =>
    spawnSync(command, args, { cwd, encoding: 'utf8', shell: false });

const publishable = [];
for (const entry of readdirSync(packagesDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = join(packagesDir, entry.name);
    const manifest = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
    if (manifest.private) continue;
    publishable.push({ dir, name: manifest.name, files: manifest.files ?? [] });
}
publishable.sort((a, b) => (a.name < b.name ? -1 : 1));

const format = (bytes) => `${(bytes / 1024 / 1024).toFixed(2)} MB`;

let failed = 0;

for (const { dir, name, files } of publishable) {
    console.log(`\n── ${name} ${'─'.repeat(Math.max(0, 60 - name.length))}`);

    // `files[]` naming something that does not exist is silent: npm just omits
    // it, publint does not flag it, and the first symptom is a blank README on
    // the npm page. `CHANGELOG.md` is exempt because `changeset version`
    // writes it at release time, after this check runs.
    const missing = files.filter(
        (entry) => entry !== 'CHANGELOG.md' && !existsSync(join(dir, entry))
    );
    if (missing.length > 0) {
        failed += 1;
        console.error(`✖ files[] — listed but not on disk: ${missing.join(', ')}`);
    } else {
        console.log('✔ files[]');
    }

    const publint = run('npx', ['--yes', 'publint', '--strict'], dir);
    if (publint.status !== 0) {
        failed += 1;
        console.error(`✖ publint\n${publint.stdout ?? ''}${publint.stderr ?? ''}`);
    } else {
        console.log('✔ publint');
    }

    // `attw` needs a packed tarball, which `--pack` produces for us. Every
    // package is ESM-only by ADR 0002, so `esm-only` is the profile to judge
    // them against — otherwise the CJS-can't-require-ESM finding is reported
    // as a problem when it is the documented decision.
    const attw = run(
        'npx',
        ['--yes', '@arethetypeswrong/cli', '--pack', '--profile', 'esm-only', '.'],
        dir
    );
    if (attw.status !== 0) {
        failed += 1;
        console.error(`✖ are-the-types-wrong\n${attw.stdout ?? ''}${attw.stderr ?? ''}`);
    } else {
        console.log('✔ are-the-types-wrong');
    }

    const packed = run('npm', ['pack', '--dry-run', '--json'], dir);
    if (packed.status !== 0) {
        failed += 1;
        console.error(`✖ npm pack\n${packed.stderr ?? ''}`);
        continue;
    }
    const [info] = JSON.parse(packed.stdout);
    const budget = SIZE_BUDGETS[name] ?? DEFAULT_BUDGET;
    if (info.unpackedSize > budget) {
        failed += 1;
        console.error(
            `✖ size — ${format(info.unpackedSize)} unpacked, over the ${format(budget)} budget`
        );
    } else {
        console.log(
            `✔ size — ${format(info.unpackedSize)} unpacked (budget ${format(budget)}), ${info.entryCount} files`
        );
    }
}

console.log(
    `\n${failed === 0 ? '✔' : '✖'} packaging checks over ${publishable.length} packages: ${failed} failure(s)`
);
process.exit(failed > 0 ? 1 : 0);
