import { homedir } from 'node:os';
import { join } from 'node:path';

/** The default public registry. Overridable per-run and per-source. */
export const DEFAULT_REGISTRY_URL = 'https://atarashi.gautamsuthar.in/registry';

/** The index is re-checked at most once a day; pinned versions are immutable. */
export const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

export interface CacheLayout {
    root: string;
    /** Verified index documents, one file per registry version. */
    index: string;
    /** Extracted blueprints, each directory named by its content hash. */
    blueprints: string;
    /** ETags and fetch timestamps. */
    meta: string;
}

/**
 * XDG on Linux, the platform convention elsewhere. `ATARASHI_CACHE_DIR` wins so
 * CI can point the whole cache at a single restorable directory.
 */
export function resolveCacheRoot(
    env: NodeJS.ProcessEnv = process.env,
    platform = process.platform
) {
    const override = env.ATARASHI_CACHE_DIR?.trim();
    if (override) return override;

    if (platform === 'win32') {
        const base = env.LOCALAPPDATA?.trim() || join(homedir(), 'AppData', 'Local');
        return join(base, 'atarashi', 'Cache');
    }
    if (platform === 'darwin') {
        return join(homedir(), 'Library', 'Caches', 'atarashi');
    }
    const xdg = env.XDG_CACHE_HOME?.trim();
    return join(xdg || join(homedir(), '.cache'), 'atarashi');
}

export function cacheLayout(root: string): CacheLayout {
    return {
        root,
        index: join(root, 'index'),
        blueprints: join(root, 'blueprints'),
        meta: join(root, 'meta.json'),
    };
}

/** `db/postgres` → `db-postgres`, so ids are usable as path and file names. */
export const slugifyId = (id: string): string => id.replace(/\//g, '-');
