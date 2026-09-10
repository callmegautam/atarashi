import { caseKey, comparePaths, normalizeProjectPath } from './paths.js';

export interface VirtualFile {
    path: string;
    contents: string | Buffer;
    mode: number;
    sources: string[];
    binary: boolean;
}

export const DEFAULT_FILE_MODE = 0o644;
export const EXECUTABLE_FILE_MODE = 0o755;

/**
 * An in-memory filesystem. Every stage of the pipeline works on one of these;
 * nothing touches disk until the writer commits. Paths are normalized on entry
 * and case collisions are detected as they happen, not on someone's Mac.
 */
export class VirtualFileSystem {
    private readonly files = new Map<string, VirtualFile>();
    /** lowercased path → the real path that claimed it first. */
    private readonly caseIndex = new Map<string, string>();

    static from(files: Iterable<VirtualFile>): VirtualFileSystem {
        const vfs = new VirtualFileSystem();
        for (const file of files) vfs.set(file.path, file.contents, file);
        return vfs;
    }

    get size(): number {
        return this.files.size;
    }

    has(path: string): boolean {
        return this.files.has(normalizeProjectPath(path));
    }

    get(path: string): VirtualFile | undefined {
        return this.files.get(normalizeProjectPath(path));
    }

    /** Returns the existing path that `path` would collide with, if any. */
    caseCollision(path: string): string | undefined {
        const normalized = normalizeProjectPath(path);
        const existing = this.caseIndex.get(caseKey(normalized));
        return existing && existing !== normalized ? existing : undefined;
    }

    set(
        path: string,
        contents: string | Buffer,
        options: { mode?: number; sources?: string[]; binary?: boolean } = {}
    ): VirtualFile {
        const normalized = normalizeProjectPath(path);
        const file: VirtualFile = {
            path: normalized,
            contents,
            mode: options.mode ?? DEFAULT_FILE_MODE,
            sources: options.sources ?? [],
            binary: options.binary ?? Buffer.isBuffer(contents),
        };
        this.files.set(normalized, file);
        this.caseIndex.set(caseKey(normalized), normalized);
        return file;
    }

    delete(path: string): boolean {
        const normalized = normalizeProjectPath(path);
        const removed = this.files.delete(normalized);
        if (removed) this.caseIndex.delete(caseKey(normalized));
        return removed;
    }

    /** Reads text, throwing for a binary file — callers that need bytes use `get`. */
    readText(path: string): string | undefined {
        const file = this.get(path);
        if (!file) return undefined;
        return typeof file.contents === 'string' ? file.contents : file.contents.toString('utf8');
    }

    /** Always sorted by path, so every consumer sees the same order. */
    list(): VirtualFile[] {
        return [...this.files.values()].sort((a, b) => comparePaths(a.path, b.path));
    }

    paths(): string[] {
        return this.list().map((file) => file.path);
    }

    /** A directory tree view for previews: `{ 'src': { 'index.ts': null } }`. */
    tree(): Record<string, unknown> {
        const root: Record<string, unknown> = {};
        for (const path of this.paths()) {
            const segments = path.split('/');
            let node = root;
            for (const segment of segments.slice(0, -1)) {
                node[segment] ??= {};
                node = node[segment] as Record<string, unknown>;
            }
            node[segments.at(-1)!] = null;
        }
        return root;
    }

    totalBytes(): number {
        let total = 0;
        for (const file of this.files.values()) {
            total += Buffer.isBuffer(file.contents)
                ? file.contents.byteLength
                : Buffer.byteLength(file.contents, 'utf8');
        }
        return total;
    }

    clone(): VirtualFileSystem {
        return VirtualFileSystem.from(this.list().map((file) => ({ ...file })));
    }
}
