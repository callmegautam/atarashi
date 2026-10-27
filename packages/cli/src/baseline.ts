import { existsSync } from 'node:fs';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
    createRegistry,
    DEFAULT_REGISTRY_URL,
    type FetchLike,
    httpGet,
    joinUrl,
    type Registry,
    readTarball,
    resolveCacheRoot,
    verifyIntegrity,
} from '@atarashi/registry';
import { AtarashiError, DIAGNOSTIC_CODES, error } from '@atarashi/schema';
import semver from 'semver';

export const NPM_REGISTRY_URL = 'https://registry.npmjs.org';
const BLUEPRINTS_PACKAGE = '@atarashi/blueprints';

export interface BaselineOptions {
    cwd: string;
    /** The version that wrote `atarashi.json`. */
    atarashiVersion: string;
    /** The version running now, whose own bundled collection needs no download. */
    runningVersion: string;
    /** The registry this run would use anyway, reused when the versions match. */
    current: Registry;
    offline?: boolean;
    cacheRoot?: string;
    npmRegistry?: string;
    fetchImpl?: FetchLike;
}

export interface Baseline {
    registry: Registry;
    /** `@atarashi/blueprints` version the baseline was built from, when it was fetched. */
    blueprintsVersion?: string;
}

interface PackageDocument {
    version?: string;
    dependencies?: Record<string, string>;
    dist?: { tarball?: string; integrity?: string };
}

async function fetchJson(url: string, fetchImpl?: FetchLike): Promise<PackageDocument> {
    const response = await httpGet(url, { fetchImpl, maxBytes: 4 * 1024 * 1024 });
    return JSON.parse(response.body.toString('utf8')) as PackageDocument;
}

const packageUrl = (registry: string, name: string, version: string) =>
    joinUrl(registry, `${name.replace('/', '%2F')}/${encodeURIComponent(version)}`);

/** Which `@atarashi/blueprints` release a given CLI release was published against. */
async function blueprintsVersionFor(
    atarashiVersion: string,
    dir: string,
    options: BaselineOptions
): Promise<string | undefined> {
    const recordPath = join(dir, `atarashi-${atarashiVersion}.json`);
    if (existsSync(recordPath)) {
        const record = JSON.parse(await readFile(recordPath, 'utf8')) as { blueprints?: string };
        if (record.blueprints) return record.blueprints;
    }
    if (options.offline) return undefined;

    const registry = options.npmRegistry ?? NPM_REGISTRY_URL;
    const cli = await fetchJson(
        packageUrl(registry, 'atarashi', atarashiVersion),
        options.fetchImpl
    );
    const range = cli.dependencies?.[BLUEPRINTS_PACKAGE];
    const version = range ? (semver.valid(range) ?? semver.minVersion(range)?.version) : undefined;
    if (!version) return undefined;

    await mkdir(dir, { recursive: true });
    await writeFile(recordPath, `${JSON.stringify({ blueprints: version })}\n`);
    return version;
}

/** Downloads, verifies and unpacks one `@atarashi/blueprints` release, once per machine. */
async function materialize(
    version: string,
    dir: string,
    options: BaselineOptions
): Promise<string | undefined> {
    const target = join(dir, `blueprints-${version}`);
    if (existsSync(join(target, 'package.json'))) return target;
    if (options.offline) return undefined;

    const registry = options.npmRegistry ?? NPM_REGISTRY_URL;
    const document = await fetchJson(
        packageUrl(registry, BLUEPRINTS_PACKAGE, version),
        options.fetchImpl
    );
    const tarballUrl = document.dist?.tarball;
    const integrity = document.dist?.integrity;
    if (!tarballUrl || !integrity) return undefined;

    const tarball = (await httpGet(tarballUrl, { fetchImpl: options.fetchImpl })).body;
    verifyIntegrity(tarball, integrity, `${BLUEPRINTS_PACKAGE}@${version}`);
    const files = await readTarball(tarball, { strip: 1 });

    const staging = `${target}.${process.pid}.tmp`;
    await rm(staging, { recursive: true, force: true });
    try {
        for (const file of files) {
            const path = join(staging, file.path);
            await mkdir(dirname(path), { recursive: true });
            await writeFile(path, file.contents, { mode: file.mode, flag: 'wx' });
        }
        await rm(target, { recursive: true, force: true });
        await rename(staging, target);
    } finally {
        await rm(staging, { recursive: true, force: true });
    }
    return target;
}

/**
 * The blueprints a project was generated from, so its original render can be
 * reproduced and compared with what is on disk. A project written by the
 * running version uses the running registry as is. An older one gets the
 * first-party collection that release shipped with, fetched from npm and
 * cached, and no remote layer: the remote index only serves the latest
 * versions, which is exactly what a baseline must not use.
 *
 * `undefined` means the baseline cannot be built here, usually offline with
 * nothing cached. Callers decide whether that is fatal.
 */
export async function loadBaseline(options: BaselineOptions): Promise<Baseline | undefined> {
    if (options.atarashiVersion === options.runningVersion) return { registry: options.current };
    if (!semver.valid(options.atarashiVersion)) return undefined;

    const dir = join(options.cacheRoot ?? resolveCacheRoot(), 'baselines');
    const version = await blueprintsVersionFor(options.atarashiVersion, dir, options);
    if (!version) return undefined;
    const bundledDir = await materialize(version, dir, options);
    if (!bundledDir) return undefined;

    const registry = createRegistry({
        cwd: options.cwd,
        offline: true,
        bundledDir,
        sources: [{ name: 'atarashi', url: DEFAULT_REGISTRY_URL, trusted: true, enabled: false }],
    });
    return { registry, blueprintsVersion: version };
}

/** The failure every lifecycle command reports when the original render cannot be rebuilt. */
export function baselineUnavailable(atarashiVersion: string): AtarashiError {
    return new AtarashiError(
        DIAGNOSTIC_CODES.REGISTRY_UNAVAILABLE,
        `Cannot reproduce the blueprints atarashi ${atarashiVersion} generated this project with`,
        [
            error(
                DIAGNOSTIC_CODES.REGISTRY_UNAVAILABLE,
                `The first-party blueprints from atarashi ${atarashiVersion} are not cached and could not be fetched from npm`,
                {
                    suggestions: [
                        'Run it once with network access; the download is cached afterwards',
                    ],
                }
            ),
        ]
    );
}
