import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { DirectorySource } from './directory.js';

const require_ = createRequire(import.meta.url);

/**
 * The first-party collection shipped inside the npm package. Its presence is
 * why `atarashi new` works on a plane: no index fetch, no tarball, no network.
 */
export function findBundledRoot(explicit?: string): string | undefined {
    if (explicit) return existsSync(explicit) ? explicit : undefined;
    try {
        return dirname(require_.resolve('@atarashi/blueprints/package.json'));
    } catch {
        return undefined;
    }
}

export interface BundledSource {
    source: DirectorySource;
    root: string;
    versionManifestPath: string;
}

export function createBundledSource(explicit?: string): BundledSource | undefined {
    const root = findBundledRoot(explicit);
    if (!root) return undefined;

    return {
        root,
        versionManifestPath: join(root, 'version-manifest.json'),
        source: new DirectorySource(join(root, 'blueprints'), {
            trusted: true,
            origin: 'bundled',
            presetsDir: join(root, 'presets'),
        }),
    };
}

/**
 * The bundled fallback for the registry's version manifest, so dependency
 * ranges resolve offline exactly as they do online.
 */
export async function readBundledVersionManifest(
    path: string
): Promise<Record<string, string> | undefined> {
    if (!existsSync(path)) return undefined;
    try {
        const raw = JSON.parse(await readFile(path, 'utf8')) as {
            packages?: Record<string, string>;
        };
        return raw.packages ?? {};
    } catch {
        return undefined;
    }
}
