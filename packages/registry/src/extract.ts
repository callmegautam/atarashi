import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, posix, resolve, sep } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { DIAGNOSTIC_CODES } from '@atarashi/schema';
import { Parser } from 'tar';
import { RegistryError } from './errors.js';

export interface ExtractLimits {
    /** Refuses archives with an absurd number of members. */
    maxEntries: number;
    /** Per-file ceiling. */
    maxFileSize: number;
    /** Total uncompressed bytes — the zip-bomb guard. */
    maxTotalSize: number;
}

export const DEFAULT_LIMITS: ExtractLimits = {
    maxEntries: 4_000,
    maxFileSize: 8 * 1024 * 1024,
    maxTotalSize: 64 * 1024 * 1024,
};

export interface ExtractedFile {
    path: string;
    mode: number;
    contents: Buffer;
}

const unsafe = (message: string, detail?: string) =>
    new RegistryError(DIAGNOSTIC_CODES.PATH_ESCAPE, message, {
        detail,
        suggestions: ['This artifact is malformed or malicious; do not use it, and report it'],
    });

const GZIP_MAGIC = [0x1f, 0x8b];

/**
 * Blueprint tarballs are `.tgz`. Decompressing here rather than inside the tar
 * parser means the uncompressed-size ceiling is enforced before a single byte
 * of tar is parsed.
 */
function decompress(tarball: Buffer, limits: ExtractLimits): Buffer {
    const gzipped = tarball[0] === GZIP_MAGIC[0] && tarball[1] === GZIP_MAGIC[1];
    if (!gzipped) return tarball;
    try {
        return gunzipSync(tarball, { maxOutputLength: limits.maxTotalSize });
    } catch (cause) {
        throw new RegistryError(
            DIAGNOSTIC_CODES.INTEGRITY_MISMATCH,
            'Tarball could not be decompressed, or exceeds the uncompressed size limit',
            { cause, detail: `limit ${limits.maxTotalSize} bytes` }
        );
    }
}

/**
 * The same path rules the writer applies to generated files, applied to archive
 * members: no absolute paths, no drive letters, no `..`, no null bytes. This is
 * a security boundary (doc 09, T1) — every rejection here is a hard failure,
 * never a skipped entry.
 */
export function safeEntryPath(raw: string, strip = 0): string | undefined {
    const unified = raw.replace(/\\/g, '/');

    if (unified.includes('\0')) throw unsafe('Archive member path contains a null byte', raw);
    if (unified.startsWith('//')) throw unsafe(`Archive member \`${raw}\` is a UNC path`);
    if (unified.startsWith('/')) throw unsafe(`Archive member \`${raw}\` is an absolute path`);
    if (/^[a-zA-Z]:\//.test(unified)) throw unsafe(`Archive member \`${raw}\` is a drive path`);

    const segments = unified.split('/').filter((segment) => segment !== '' && segment !== '.');
    if (segments.includes('..')) {
        throw unsafe(`Archive member \`${raw}\` escapes the extraction directory`);
    }

    const stripped = segments.slice(strip);
    if (stripped.length === 0) return undefined; // the stripped root directory itself
    return posix.join(...stripped);
}

/**
 * Parses a tarball entirely in memory. Nothing reaches the filesystem until
 * every member has been validated, so a malicious archive cannot leave a
 * half-extracted mess behind.
 */
export async function readTarball(
    tarball: Buffer,
    options: { strip?: number; limits?: Partial<ExtractLimits> } = {}
): Promise<ExtractedFile[]> {
    const limits = { ...DEFAULT_LIMITS, ...options.limits };
    const raw = decompress(tarball, limits);

    const files: ExtractedFile[] = [];
    const seen = new Set<string>();
    let entries = 0;
    let total = 0;
    let failure: unknown;

    const parser = new Parser({
        onReadEntry(entry) {
            try {
                if (failure) {
                    entry.resume();
                    return;
                }
                if (++entries > limits.maxEntries) {
                    throw unsafe(`Archive has more than ${limits.maxEntries} members`);
                }

                // Symlinks and hard links can point anywhere; devices and FIFOs
                // have no business in a blueprint. Directories are implied by
                // the files inside them.
                if (entry.type === 'SymbolicLink' || entry.type === 'Link') {
                    throw unsafe(`Archive member \`${entry.path}\` is a link`);
                }
                if (entry.type === 'Directory' || entry.type === 'GNUDumpDir') {
                    entry.resume();
                    return;
                }
                if (
                    entry.type !== 'File' &&
                    entry.type !== 'OldFile' &&
                    entry.type !== 'ContiguousFile'
                ) {
                    throw unsafe(
                        `Archive member \`${entry.path}\` has unsupported type ${entry.type}`
                    );
                }

                const path = safeEntryPath(String(entry.path), options.strip ?? 0);
                if (path === undefined) {
                    entry.resume();
                    return;
                }
                if (seen.has(path.toLowerCase())) {
                    throw unsafe(`Archive contains \`${path}\` twice, or two names that collide`);
                }
                seen.add(path.toLowerCase());

                if ((entry.size ?? 0) > limits.maxFileSize) {
                    throw unsafe(
                        `Archive member \`${path}\` is larger than the ${limits.maxFileSize} byte limit`
                    );
                }

                const chunks: Buffer[] = [];
                let size = 0;
                entry.on('data', (chunk: Buffer) => {
                    size += chunk.length;
                    total += chunk.length;
                    if (size > limits.maxFileSize || total > limits.maxTotalSize) {
                        failure ??= unsafe(`Archive exceeds the ${limits.maxTotalSize} byte limit`);
                        return;
                    }
                    chunks.push(chunk);
                });
                entry.on('end', () => {
                    if (failure) return;
                    // Executable bit only; everything else is normalized away.
                    const mode = (entry.mode ?? 0o644) & 0o111 ? 0o755 : 0o644;
                    files.push({ path, mode, contents: Buffer.concat(chunks) });
                });
            } catch (thrown) {
                failure ??= thrown;
                entry.resume();
            }
        },
    });

    await new Promise<void>((resolvePromise, rejectPromise) => {
        parser.on('error', rejectPromise);
        parser.on('end', () => resolvePromise());
        parser.end(raw);
    });

    if (failure) throw failure;
    if (files.length === 0) throw unsafe('Archive contains no files');

    return files.sort((a, b) => (a.path < b.path ? -1 : 1));
}

/**
 * Writes a validated archive into `dest`. Every resolved path is re-checked
 * against the destination root, so a bug in the path rules above still cannot
 * write outside it.
 */
export async function extractTarball(
    tarball: Buffer,
    dest: string,
    options: { strip?: number; limits?: Partial<ExtractLimits> } = {}
): Promise<string[]> {
    const files = await readTarball(tarball, options);
    const root = resolve(dest);

    for (const file of files) {
        const target = resolve(root, file.path);
        if (target !== root && !target.startsWith(root + sep)) {
            throw unsafe(
                `Archive member \`${file.path}\` resolves outside the extraction directory`
            );
        }
    }

    await mkdir(root, { recursive: true });
    for (const file of files) {
        const target = join(root, file.path);
        await mkdir(dirname(target), { recursive: true });
        // `wx` fails rather than following a symlink someone planted at the
        // target path, and catches two members writing the same file.
        await writeFile(target, file.contents, { mode: file.mode, flag: 'wx' });
    }

    return files.map((file) => file.path);
}
