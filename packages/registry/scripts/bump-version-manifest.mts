/**
 * Proposes bumps to the shared version manifest — the one file that decides
 * which range every blueprint gets for a dependency.
 *
 * It only rewrites the file and reports what changed. Whether the bump is safe
 * is decided by the generation matrix in CI, which is what gates the PR.
 *
 *   node --experimental-strip-types scripts/bump-version-manifest.mts [--dry-run]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const manifestPath = join(here, '..', '..', 'blueprints', 'version-manifest.json');
const dryRun = process.argv.includes('--dry-run');

interface VersionManifest {
    version: string;
    updatedAt: string;
    packages: Record<string, string>;
}

/** Keeps the operator the manifest already used: `^5.1.0` stays caret-ranged. */
function reRange(current: string, latest: string): string {
    const prefix = /^[~^]/.exec(current)?.[0] ?? '';
    return `${prefix}${latest}`;
}

async function latestVersion(name: string): Promise<string | undefined> {
    const response = await fetch(`https://registry.npmjs.org/${encodeURIComponent(name)}/latest`, {
        headers: { accept: 'application/vnd.npm.install-v1+json, application/json' },
    });
    if (!response.ok) return undefined;
    const body = (await response.json()) as { version?: string };
    return body.version;
}

const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as VersionManifest;
const changes: { name: string; from: string; to: string }[] = [];

for (const [name, range] of Object.entries(manifest.packages).sort()) {
    const latest = await latestVersion(name);
    if (!latest) {
        console.warn(`? ${name}: npm did not answer; leaving ${range}`);
        continue;
    }
    const next = reRange(range, latest);
    if (next !== range) changes.push({ name, from: range, to: next });
}

if (changes.length === 0) {
    console.log('version manifest is up to date');
    process.exit(0);
}

for (const change of changes) console.log(`↑ ${change.name}  ${change.from} → ${change.to}`);

if (dryRun) process.exit(0);

// A dependency bump is a minor registry change: blueprints gain nothing and
// lose nothing, but their output changes.
const [major = '1', minor = '0'] = manifest.version.split('.');
const updated: VersionManifest = {
    version: `${major}.${Number(minor) + 1}.0`,
    updatedAt: new Date().toISOString(),
    packages: Object.fromEntries(
        Object.entries(manifest.packages).map(([name, range]) => [
            name,
            changes.find((change) => change.name === name)?.to ?? range,
        ])
    ),
};

writeFileSync(manifestPath, `${JSON.stringify(updated, null, 2)}\n`);
console.log(`\nversion manifest ${manifest.version} → ${updated.version}`);
