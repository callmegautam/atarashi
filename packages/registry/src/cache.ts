import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { DIAGNOSTIC_CODES, parseRegistryIndex, type RegistryIndex } from '@atarashi/schema';
import { integrityFailure, RegistryError } from './errors.js';
import { extractTarball } from './extract.js';
import { hexDigest, parseIntegrity, verifyIndexIntegrity, verifyIntegrity } from './integrity.js';
import { type CacheLayout, cacheLayout, slugifyId } from './paths.js';

/** What we remember between runs: ETags, fetch times and what is extracted. */
export interface CacheMeta {
    metaVersion: 1;
    index: Record<string, { etag?: string; fetchedAt: string; version: string }>;
    blueprints: Record<string, { id: string; version: string; integrity: string; dir: string }>;
}

const EMPTY_META: CacheMeta = { metaVersion: 1, index: {}, blueprints: {} };

/** A cache directory counts as populated only once its manifest is in place. */
const hasManifest = (dir: string): boolean =>
    existsSync(join(dir, 'blueprint.json')) || existsSync(join(dir, 'preset.json'));

const readJson = async (path: string): Promise<unknown> => {
    const raw = await readFile(path, 'utf8');
    return JSON.parse(raw) as unknown;
};

const writeJson = async (path: string, value: unknown): Promise<void> => {
    await mkdir(join(path, '..'), { recursive: true });
    // Write-then-rename: a killed process never leaves a truncated cache file.
    const temporary = `${path}.${process.pid}.tmp`;
    await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
    await rename(temporary, path);
};

/**
 * The on-disk cache. Content-addressed: a blueprint directory is named by its
 * tarball's hash, so entries for different versions never collide and the whole
 * directory is safe to share between projects and CI runs.
 */
export class RegistryCache {
    readonly layout: CacheLayout;
    private meta: CacheMeta | undefined;

    constructor(root: string) {
        this.layout = cacheLayout(root);
    }

    async readMeta(): Promise<CacheMeta> {
        if (this.meta) return this.meta;
        try {
            const parsed = (await readJson(this.layout.meta)) as CacheMeta;
            this.meta =
                parsed && parsed.metaVersion === 1
                    ? { ...EMPTY_META, ...parsed }
                    : { ...EMPTY_META };
        } catch {
            // A missing or unreadable cache is not an error; it is a cold cache.
            this.meta = { ...EMPTY_META };
        }
        return this.meta;
    }

    async writeMeta(update: (meta: CacheMeta) => void): Promise<void> {
        const meta = await this.readMeta();
        update(meta);
        this.meta = meta;
        await writeJson(this.layout.meta, meta);
    }

    indexPath(version: string): string {
        return join(this.layout.index, `${version}.json`);
    }

    async readIndex(version: string, source: string): Promise<RegistryIndex | undefined> {
        const path = this.indexPath(version);
        if (!existsSync(path)) return undefined;

        let raw: unknown;
        try {
            raw = await readJson(path);
        } catch (cause) {
            await rm(path, { force: true });
            throw new RegistryError(
                DIAGNOSTIC_CODES.REGISTRY_UNAVAILABLE,
                `Cached registry index ${version} is unreadable`,
                { cause, suggestions: ['Run `atarashi registry update` to fetch it again'] }
            );
        }

        const parsed = parseRegistryIndex(raw, path);
        if (!parsed.ok) {
            await rm(path, { force: true });
            throw new RegistryError(parsed.error.code, parsed.error.message, {
                suggestions: ['Run `atarashi registry update` to fetch a fresh index'],
            });
        }

        verifyIndexIntegrity(parsed.value, `${source} (cached)`);
        return parsed.value;
    }

    async writeIndex(index: RegistryIndex): Promise<void> {
        await mkdir(this.layout.index, { recursive: true });
        await writeJson(this.indexPath(index.version), index);
    }

    /** Every registry version this machine has already verified. */
    async cachedIndexVersions(): Promise<string[]> {
        try {
            const files = await readdir(this.layout.index);
            return files
                .filter((file) => file.endsWith('.json'))
                .map((file) => file.slice(0, -'.json'.length));
        } catch {
            return [];
        }
    }

    /**
     * Content-addressed, but still legible: `db-postgres-1.2.0-8f2c…`. The hash
     * suffix is what makes it content-addressed; the rest is for humans reading
     * `atarashi registry verify` output.
     */
    blueprintDir(id: string, version: string, integrity: string): string {
        const { base64 } = parseIntegrity(integrity);
        const short = Buffer.from(base64, 'base64').toString('hex').slice(0, 12);
        return join(this.layout.blueprints, `${slugifyId(id)}-${version}-${short}`);
    }

    hasBlueprint(id: string, version: string, integrity: string): boolean {
        return hasManifest(this.blueprintDir(id, version, integrity));
    }

    /**
     * Verifies, extracts into a temp directory, then renames into place — so a
     * cache directory only ever exists in its complete, verified form.
     */
    async storeBlueprint(
        entry: { id: string; version: string; integrity: string },
        tarball: Buffer
    ): Promise<string> {
        verifyIntegrity(tarball, entry.integrity, `${entry.id}@${entry.version}`);

        const target = this.blueprintDir(entry.id, entry.version, entry.integrity);
        if (hasManifest(target)) return target;

        const staging = `${target}.${process.pid}.${hexDigest(String(Date.now())).slice(0, 8)}`;
        await rm(staging, { recursive: true, force: true });

        try {
            await extractTarball(tarball, staging);
            if (!hasManifest(staging)) {
                throw integrityFailure(
                    `${entry.id}@${entry.version} has no \`blueprint.json\` at its root`
                );
            }
            await mkdir(this.layout.blueprints, { recursive: true });
            await rm(target, { recursive: true, force: true });
            await rename(staging, target);
        } finally {
            await rm(staging, { recursive: true, force: true });
        }

        await this.writeMeta((meta) => {
            meta.blueprints[`${entry.id}@${entry.version}`] = {
                id: entry.id,
                version: entry.version,
                integrity: entry.integrity,
                dir: target,
            };
        });

        return target;
    }

    async clear(): Promise<void> {
        this.meta = undefined;
        await rm(this.layout.root, { recursive: true, force: true });
    }

    /**
     * Re-checks that everything the meta file claims is cached is still there.
     * Extracted trees cannot be re-hashed against the tarball digest, so this
     * reports presence and shape, and prunes what has gone missing.
     */
    async verify(): Promise<{ checked: number; removed: string[] }> {
        const meta = await this.readMeta();
        const removed: string[] = [];
        let checked = 0;

        for (const [key, record] of Object.entries(meta.blueprints)) {
            checked += 1;
            if (!hasManifest(record.dir)) removed.push(key);
        }

        for (const version of await this.cachedIndexVersions()) {
            checked += 1;
            try {
                await this.readIndex(version, 'cache');
            } catch {
                removed.push(`index@${version}`);
            }
        }

        if (removed.length > 0) {
            await this.writeMeta((current) => {
                for (const key of removed) delete current.blueprints[key];
            });
        }

        return { checked, removed };
    }

    async size(): Promise<number> {
        const walk = async (dir: string): Promise<number> => {
            let total = 0;
            let entries: string[];
            try {
                entries = await readdir(dir);
            } catch {
                return 0;
            }
            for (const entry of entries) {
                const path = join(dir, entry);
                const info = await stat(path).catch(() => undefined);
                if (!info) continue;
                total += info.isDirectory() ? await walk(path) : info.size;
            }
            return total;
        };
        return walk(this.layout.root);
    }
}
