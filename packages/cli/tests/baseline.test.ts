import { existsSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { createRegistry, digest, type FetchLike } from '@atarashi/registry';
import { afterEach, describe, expect, it } from 'vitest';
import { loadBaseline, NPM_REGISTRY_URL } from '../src/baseline.js';

/** Just enough ustar to carry a package: regular files, `package/` prefix. */
function tgz(files: Record<string, string>): Buffer {
    const blocks: Buffer[] = [];
    for (const [path, contents] of Object.entries(files)) {
        const body = Buffer.from(contents);
        const header = Buffer.alloc(512);
        header.write(`package/${path}`, 0);
        header.write('0000644\0', 100);
        header.write('0000000\0', 108);
        header.write('0000000\0', 116);
        header.write(`${body.length.toString(8).padStart(11, '0')}\0`, 124);
        header.write('00000000000\0', 136);
        header.write('        ', 148);
        header.write('0', 156);
        header.write('ustar\0', 257);
        header.write('00', 263);
        const sum = header.reduce((total, byte) => total + byte, 0);
        header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
        blocks.push(header, body, Buffer.alloc((512 - (body.length % 512)) % 512));
    }
    blocks.push(Buffer.alloc(1024));
    return gzipSync(Buffer.concat(blocks));
}

const MANIFEST = {
    manifestVersion: 1,
    id: 'meta/readme',
    name: 'README',
    version: '0.9.0',
    description: 'A README',
    category: 'meta',
    provides: ['docs:readme'],
};

const tarball = tgz({
    'package.json': JSON.stringify({ name: '@atarashi/blueprints', version: '0.9.9' }),
    'blueprints/meta/readme/blueprint.json': JSON.stringify(MANIFEST),
    'version-manifest.json': JSON.stringify({ packages: {} }),
});

const TARBALL_URL = `${NPM_REGISTRY_URL}/@atarashi/blueprints/-/blueprints-0.9.9.tgz`;

function npmStub(integrity = digest(tarball, 'sha512')) {
    const calls: string[] = [];
    const fetchImpl: FetchLike = async (url) => {
        calls.push(url);
        const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
        if (url === `${NPM_REGISTRY_URL}/atarashi/0.9.9`) {
            return json({ dependencies: { '@atarashi/blueprints': '0.9.9' } });
        }
        if (url === `${NPM_REGISTRY_URL}/@atarashi%2Fblueprints/0.9.9`) {
            return json({ dist: { tarball: TARBALL_URL, integrity } });
        }
        if (url === TARBALL_URL) return new Response(new Uint8Array(tarball), { status: 200 });
        return new Response('not found', { status: 404 });
    };
    return { calls, fetchImpl };
}

const dirs: string[] = [];
const scratch = async () => {
    const dir = await mkdtemp(join(tmpdir(), 'atarashi-baseline-'));
    dirs.push(dir);
    return dir;
};

afterEach(async () => {
    while (dirs.length > 0) await rm(dirs.pop()!, { recursive: true, force: true });
});

describe('loadBaseline', () => {
    it('reuses the running registry for a project this version wrote', async () => {
        const current = createRegistry({ offline: true });
        const baseline = await loadBaseline({
            cwd: await scratch(),
            atarashiVersion: '1.2.3',
            runningVersion: '1.2.3',
            current,
        });
        expect(baseline?.registry).toBe(current);
    });

    it('fetches, verifies and caches the blueprints an older release shipped', async () => {
        const cacheRoot = await scratch();
        const { calls, fetchImpl } = npmStub();
        const options = {
            cwd: await scratch(),
            atarashiVersion: '0.9.9',
            runningVersion: '1.0.0',
            current: createRegistry({ offline: true }),
            cacheRoot,
            fetchImpl,
        };

        const baseline = await loadBaseline(options);
        expect(baseline?.blueprintsVersion).toBe('0.9.9');
        expect((await baseline!.registry.load('meta/readme'))?.manifest.version).toBe('0.9.0');
        expect(calls).toHaveLength(3);

        const cached = join(cacheRoot, 'baselines', 'blueprints-0.9.9', 'package.json');
        expect(JSON.parse(await readFile(cached, 'utf8')).version).toBe('0.9.9');

        const again = await loadBaseline({ ...options, offline: true });
        expect(again?.blueprintsVersion).toBe('0.9.9');
        expect(calls).toHaveLength(3);
    });

    it('rejects a tarball that fails its integrity check, and caches nothing', async () => {
        const cacheRoot = await scratch();
        const { fetchImpl } = npmStub(digest(Buffer.from('something else'), 'sha512'));

        await expect(
            loadBaseline({
                cwd: await scratch(),
                atarashiVersion: '0.9.9',
                runningVersion: '1.0.0',
                current: createRegistry({ offline: true }),
                cacheRoot,
                fetchImpl,
            })
        ).rejects.toThrow(/Integrity check failed/);
        expect(existsSync(join(cacheRoot, 'baselines', 'blueprints-0.9.9'))).toBe(false);
    });

    it('gives up offline when nothing is cached', async () => {
        const baseline = await loadBaseline({
            cwd: await scratch(),
            atarashiVersion: '0.9.9',
            runningVersion: '1.0.0',
            current: createRegistry({ offline: true }),
            cacheRoot: await scratch(),
            offline: true,
        });
        expect(baseline).toBeUndefined();
    });

    it('gives up on a version string that is not semver', async () => {
        const baseline = await loadBaseline({
            cwd: await scratch(),
            atarashiVersion: 'dev',
            runningVersion: '1.0.0',
            current: createRegistry({ offline: true }),
        });
        expect(baseline).toBeUndefined();
    });
});
