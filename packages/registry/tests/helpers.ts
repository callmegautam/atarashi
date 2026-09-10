import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import type { RegistryIndex } from '@atarashi/schema';
import { create } from 'tar';
import { digest, indexRootHash } from '../src/integrity.js';

export const tempDir = (prefix = 'atarashi-registry-') => mkdtemp(join(tmpdir(), prefix));

export interface TarEntry {
    name: string;
    contents?: string;
    /** ustar type flag: `0` file, `1` hard link, `2` symlink, `5` directory. */
    type?: '0' | '1' | '2' | '5';
    linkname?: string;
    mode?: number;
    /** Declare a size that disagrees with the contents, for limit tests. */
    declaredSize?: number;
}

const pad = (value: number, length: number) => `${value.toString(8).padStart(length - 1, '0')}\0`;

/**
 * A minimal ustar writer. The real packer is `tar`, but crafting hostile
 * archives — traversal, symlinks, oversized members — needs byte-level control
 * that `tar.create` deliberately refuses to give.
 */
export function makeTar(entries: TarEntry[]): Buffer {
    const blocks: Buffer[] = [];

    for (const entry of entries) {
        const body = Buffer.from(entry.contents ?? '', 'utf8');
        const size = entry.declaredSize ?? body.length;
        const header = Buffer.alloc(512, 0);

        header.write(entry.name.slice(0, 100), 0, 'utf8');
        header.write(pad(entry.mode ?? 0o644, 8), 100);
        header.write(pad(0, 8), 108);
        header.write(pad(0, 8), 116);
        header.write(pad(size, 12), 124);
        header.write(pad(0, 12), 136);
        header.write('        ', 148); // checksum placeholder
        header.write(entry.type ?? '0', 156);
        if (entry.linkname) header.write(entry.linkname.slice(0, 100), 157, 'utf8');
        header.write('ustar\0', 257);
        header.write('00', 263);

        let checksum = 0;
        for (const byte of header) checksum += byte;
        header.write(pad(checksum, 8), 148);

        blocks.push(header);
        if (size > 0) {
            const padded = Buffer.alloc(Math.ceil(body.length / 512) * 512, 0);
            body.copy(padded);
            blocks.push(padded);
        }
    }

    blocks.push(Buffer.alloc(1024, 0)); // two empty blocks end the archive
    return Buffer.concat(blocks);
}

/** Writes a blueprint tree to disk and returns its directory. */
export async function writeBlueprint(
    root: string,
    manifest: Record<string, unknown> & { id: string },
    files: Record<string, string> = {}
): Promise<string> {
    const dir = join(root, ...manifest.id.split('/'));
    await mkdir(dir, { recursive: true });

    const full = {
        manifestVersion: 1,
        name: manifest.id,
        version: '1.0.0',
        description: `Fixture ${manifest.id}`,
        category: 'test',
        ...manifest,
    };
    await writeFile(join(dir, 'blueprint.json'), JSON.stringify(full, null, 2));

    for (const [path, contents] of Object.entries(files)) {
        const target = join(dir, path);
        await mkdir(dirname(target), { recursive: true });
        await writeFile(target, contents);
    }
    return dir;
}

/** Packs a directory the way the publish script does: gzipped, portable, sorted. */
export async function packDir(dir: string): Promise<Buffer> {
    const chunks: Buffer[] = [];
    const stream = create({ cwd: dir, gzip: true, portable: true }, ['.']);
    for await (const chunk of stream) chunks.push(Buffer.from(chunk as Uint8Array));
    return Buffer.concat(chunks);
}

export interface IndexFixture {
    index: RegistryIndex;
    tarballs: Map<string, Buffer>;
}

/** Builds a signed-in-the-same-way-as-production index over real tarballs. */
export function makeIndex(
    entries: {
        id: string;
        version?: string;
        provides?: string[];
        requires?: string[];
        kind?: 'blueprint' | 'preset';
        tarball: Buffer;
    }[],
    options: { version?: string; packages?: Record<string, string> } = {}
): IndexFixture {
    const tarballs = new Map<string, Buffer>();

    const built = entries.map((entry) => {
        const version = entry.version ?? '1.0.0';
        const url = `bp/${entry.id.replace(/\//g, '-')}-${version}.tgz`;
        tarballs.set(url, entry.tarball);
        return {
            id: entry.id,
            kind: entry.kind ?? ('blueprint' as const),
            name: entry.id,
            version,
            description: `Registry ${entry.id}`,
            category: 'test',
            tags: [],
            provides: entry.provides ?? [],
            requires: entry.requires ?? [],
            conflicts: [],
            engines: {},
            experimental: false,
            deprecated: false,
            tarball: url,
            integrity: digest(entry.tarball),
            bundled: false,
        };
    });

    const versionManifest = options.packages
        ? {
              version: '1.0.0',
              updatedAt: '2026-01-01T00:00:00.000Z',
              packages: options.packages,
          }
        : undefined;

    const base = {
        indexVersion: 1,
        version: options.version ?? '1.0.0',
        updatedAt: '2026-01-01T00:00:00.000Z',
        entries: built,
        ...(versionManifest ? { versionManifest } : {}),
    };

    return {
        index: { ...base, integrity: indexRootHash(base) } as RegistryIndex,
        tarballs,
    };
}

export interface StubCall {
    url: string;
    headers: Record<string, string>;
}

/** A `fetch` stand-in that serves an index and its tarballs, and records calls. */
export function stubFetch(
    fixture: IndexFixture,
    options: { etag?: string; failWith?: Error } = {}
) {
    const calls: StubCall[] = [];

    const impl = async (url: string, init?: RequestInit): Promise<Response> => {
        const headers = Object.fromEntries(
            Object.entries((init?.headers as Record<string, string>) ?? {})
        );
        calls.push({ url, headers });

        if (options.failWith) throw options.failWith;

        const respond = (body: Buffer | string, status = 200, extra: Record<string, string> = {}) =>
            new Response(status === 304 ? null : body, {
                status,
                headers: { ...(options.etag ? { etag: options.etag } : {}), ...extra },
            });

        if (url.endsWith('index.json')) {
            if (options.etag && headers['if-none-match'] === options.etag) return respond('', 304);
            return respond(JSON.stringify(fixture.index));
        }

        for (const [path, tarball] of fixture.tarballs) {
            if (url.endsWith(path)) return respond(tarball);
        }
        return new Response('not found', { status: 404 });
    };

    return { impl, calls };
}
