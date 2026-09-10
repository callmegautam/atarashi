/**
 * Builds a publishable registry: one tarball per blueprint and preset, plus the
 * `index.json` that describes them and the root hash that makes the whole thing
 * verifiable.
 *
 * Output is deterministic — sorted members, a fixed mtime, no uid/gid — so
 * rebuilding the same sources twice produces byte-identical tarballs and the
 * same integrity digests. Run after `pnpm build`.
 *
 *   node --experimental-strip-types scripts/build-index.mts \
 *     --blueprints ../blueprints --out dist-registry --version 1.4.2
 */
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { create } from 'tar';

// Imported from the build output so this script needs no TS loader of its own.
import { canonicalize, digest, indexRootHash } from '../dist/index.js';

const here = dirname(fileURLToPath(import.meta.url));

const flag = (name: string, fallback?: string): string | undefined => {
    const index = process.argv.indexOf(`--${name}`);
    return index === -1 ? fallback : process.argv[index + 1];
};

const blueprintsPackage = join(here, '..', '..', flag('blueprints', 'blueprints')!);
const outDir = join(here, '..', flag('out', 'dist-registry')!);

const readJson = <T,>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

/** Every file under `dir`, POSIX-relative and sorted, so packing is stable. */
async function filesIn(dir: string, prefix = ''): Promise<string[]> {
    const entries = await readdir(dir, { withFileTypes: true });
    const files: string[] = [];
    for (const entry of entries.sort((a, b) => (a.name < b.name ? -1 : 1))) {
        const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...(await filesIn(join(dir, entry.name), rel)));
        else if (entry.isFile()) files.push(rel);
    }
    return files;
}

async function pack(dir: string, target: string): Promise<Buffer> {
    const files = await filesIn(dir);
    const chunks: Buffer[] = [];
    const stream = create(
        {
            cwd: dir,
            gzip: { level: 9 },
            portable: true,
            noDirRecurse: true,
            mtime: new Date(0),
        },
        files
    );
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));

    const tarball = Buffer.concat(chunks);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, tarball);
    return tarball;
}

interface ManifestLike {
    id: string;
    kind?: 'blueprint' | 'preset';
    name: string;
    version: string;
    description: string;
    category?: string;
    tags?: string[];
    provides?: string[];
    requires?: string[];
    conflicts?: string[];
    engines?: { atarashi?: string };
    experimental?: boolean;
    deprecated?: unknown;
}

const slug = (id: string) => id.replace(/\//g, '-');

async function main() {
    const packageJson = readJson<{ version: string }>(join(blueprintsPackage, 'package.json'));
    const version = flag('version', packageJson.version)!;

    const blueprintsRoot = join(blueprintsPackage, 'blueprints');
    const presetsRoot = join(blueprintsPackage, 'presets');
    const versionManifestPath = join(blueprintsPackage, 'version-manifest.json');

    await rm(outDir, { recursive: true, force: true });

    const entries: Record<string, unknown>[] = [];

    // Blueprints: `<root>/<namespace>/<name>/blueprint.json`.
    if (existsSync(blueprintsRoot)) {
        for (const namespace of (await readdir(blueprintsRoot, { withFileTypes: true })).sort()) {
            if (!namespace.isDirectory()) continue;
            const namespaceDir = join(blueprintsRoot, namespace.name);
            for (const name of (await readdir(namespaceDir, { withFileTypes: true })).sort()) {
                if (!name.isDirectory()) continue;
                const dir = join(namespaceDir, name.name);
                const manifestPath = join(dir, 'blueprint.json');
                if (!existsSync(manifestPath)) continue;

                const manifest = readJson<ManifestLike>(manifestPath);
                const tarballPath = `bp/${slug(manifest.id)}-${manifest.version}.tgz`;
                const tarball = await pack(dir, join(outDir, tarballPath));

                entries.push({
                    id: manifest.id,
                    kind: 'blueprint',
                    name: manifest.name,
                    version: manifest.version,
                    description: manifest.description,
                    category: manifest.category ?? 'misc',
                    tags: manifest.tags ?? [],
                    provides: manifest.provides ?? [],
                    requires: manifest.requires ?? [],
                    conflicts: manifest.conflicts ?? [],
                    engines: manifest.engines ?? {},
                    experimental: manifest.experimental ?? false,
                    deprecated: Boolean(manifest.deprecated),
                    tarball: tarballPath,
                    integrity: digest(tarball),
                    bundled: true,
                });
                console.log(`  ${manifest.id}@${manifest.version}  ${tarball.byteLength} B`);
            }
        }
    }

    // Presets ship as single-file tarballs so they verify the same way.
    if (existsSync(presetsRoot)) {
        for (const file of (await readdir(presetsRoot)).filter((f) => f.endsWith('.json')).sort()) {
            const manifest = readJson<ManifestLike>(join(presetsRoot, file));
            const staging = join(outDir, '.staging', slug(manifest.id));
            await mkdir(staging, { recursive: true });
            await writeFile(
                join(staging, 'preset.json'),
                readFileSync(join(presetsRoot, file), 'utf8')
            );

            const tarballPath = `bp/${slug(manifest.id)}-${manifest.version}.tgz`;
            const tarball = await pack(staging, join(outDir, tarballPath));

            entries.push({
                id: manifest.id,
                kind: 'preset',
                name: manifest.name,
                version: manifest.version,
                description: manifest.description,
                category: 'preset',
                tags: manifest.tags ?? [],
                provides: [],
                requires: [],
                conflicts: [],
                engines: {},
                experimental: manifest.experimental ?? false,
                deprecated: Boolean(manifest.deprecated),
                tarball: tarballPath,
                integrity: digest(tarball),
                bundled: true,
            });
            console.log(`  ${manifest.id}@${manifest.version}`);
        }
        await rm(join(outDir, '.staging'), { recursive: true, force: true });
    }

    entries.sort((a, b) => ((a.id as string) < (b.id as string) ? -1 : 1));

    const versionManifest = existsSync(versionManifestPath)
        ? readJson<Record<string, unknown>>(versionManifestPath)
        : undefined;

    const base = {
        $schema: 'https://unpkg.com/@atarashi/schema/schemas/registry-index.schema.json',
        indexVersion: 1,
        version,
        updatedAt: new Date().toISOString(),
        entries,
        ...(versionManifest ? { versionManifest } : {}),
    };

    const index = { ...base, integrity: indexRootHash(base as never) };
    const body = `${JSON.stringify(index, null, 2)}\n`;

    // Both the mutable "latest" path and the immutable pinned one.
    await mkdir(join(outDir, 'v1', version), { recursive: true });
    await writeFile(join(outDir, 'v1', 'index.json'), body);
    await writeFile(join(outDir, 'v1', version, 'index.json'), body);

    console.log(`\nregistry ${version}: ${entries.length} entries`);
    console.log(`root hash ${index.integrity}`);
    console.log(`canonical bytes ${canonicalize(base as never).length}`);
    console.log(`→ ${relative(process.cwd(), outDir)}`);
}

await main();
