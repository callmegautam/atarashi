#!/usr/bin/env node
// Runs `atarashi create-blueprint --validate` over every first-party
// blueprint, so the CLI-exposed conformance suite (doc 08 §3) is checked as
// a whole before a release, not just one directory at a time.
import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = join(root, 'packages/cli/dist/cli.js');
const blueprintsDir = join(root, 'packages/blueprints/blueprints');

const isDir = (path) => {
    try {
        return readdirSync(path, { withFileTypes: true });
    } catch {
        return undefined;
    }
};

const ids = [];
for (const namespace of readdirSync(blueprintsDir, { withFileTypes: true })) {
    if (!namespace.isDirectory()) continue;
    const namespaceDir = join(blueprintsDir, namespace.name);
    for (const name of readdirSync(namespaceDir, { withFileTypes: true })) {
        if (!name.isDirectory()) continue;
        if (isDir(join(namespaceDir, name.name))) ids.push(`${namespace.name}/${name.name}`);
    }
}
ids.sort();

if (ids.length === 0) {
    console.error(`No blueprints found under ${blueprintsDir}`);
    process.exit(1);
}

let failed = 0;
for (const id of ids) {
    const dir = join(blueprintsDir, id);
    const result = spawnSync(process.execPath, [cli, 'create-blueprint', '--validate', dir], {
        stdio: 'inherit',
    });
    if (result.status !== 0) failed += 1;
}

console.log(`\n${ids.length - failed}/${ids.length} blueprints passed --validate`);
process.exit(failed > 0 ? 1 : 0);
