import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * The on-disk root of the first-party collection. The registry's bundled loader
 * resolves this package and reads `blueprints/`, `presets/` and
 * `version-manifest.json` from beside it, so the path has to survive both the
 * source tree and the published tarball — hence resolving from `dist/`.
 */
export const collectionRoot = (): string => join(dirname(fileURLToPath(import.meta.url)), '..');

export const blueprintsDir = (): string => join(collectionRoot(), 'blueprints');
export const presetsDir = (): string => join(collectionRoot(), 'presets');
export const versionManifestPath = (): string => join(collectionRoot(), 'version-manifest.json');
