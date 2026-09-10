import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { RegistryError, unavailable } from './errors.js';
import { DEFAULT_LIMITS } from './extract.js';

export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

export interface HttpResponse {
    status: number;
    body: Buffer;
    etag: string | undefined;
}

/**
 * TLS only, with no plaintext fallback (doc 09, T4). `file:` is allowed so a
 * local mirror — and the test suite — can stand in for the CDN.
 */
export function assertFetchable(url: string): URL {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        throw unavailable(`\`${url}\` is not a valid registry URL`);
    }
    if (parsed.protocol === 'https:' || parsed.protocol === 'file:') return parsed;
    if (parsed.protocol === 'http:') {
        throw unavailable(`Refusing to fetch the registry over plain HTTP: ${url}`, [
            'Use an `https://` registry URL',
        ]);
    }
    throw unavailable(`Unsupported registry protocol \`${parsed.protocol}\` in ${url}`);
}

export interface HttpOptions {
    etag?: string | undefined;
    timeoutMs?: number;
    maxBytes?: number;
    fetchImpl?: FetchLike;
}

/**
 * A conditional GET. `304` comes back with an empty body and the caller keeps
 * what it has cached; anything else is a registry failure with the URL named.
 */
export async function httpGet(url: string, options: HttpOptions = {}): Promise<HttpResponse> {
    const parsed = assertFetchable(url);
    const maxBytes = options.maxBytes ?? DEFAULT_LIMITS.maxTotalSize;

    if (parsed.protocol === 'file:') {
        try {
            const body = await readFile(fileURLToPath(parsed));
            return { status: 200, body, etag: undefined };
        } catch {
            throw unavailable(`Cannot read ${url}`);
        }
    }

    const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike | undefined);
    if (!fetchImpl) {
        throw unavailable('This Node build has no global `fetch`', [
            'Upgrade to Node 20.11 or newer',
        ]);
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);

    try {
        const headers: Record<string, string> = { accept: 'application/json, application/gzip' };
        if (options.etag) headers['if-none-match'] = options.etag;

        const response = await fetchImpl(url, { headers, signal: controller.signal });
        const etag = response.headers.get('etag') ?? undefined;

        if (response.status === 304) return { status: 304, body: Buffer.alloc(0), etag };
        if (!response.ok) {
            throw unavailable(`${url} responded ${response.status} ${response.statusText}`.trim());
        }

        const body = Buffer.from(await response.arrayBuffer());
        if (body.byteLength > maxBytes) {
            throw unavailable(
                `${url} returned ${body.byteLength} bytes, over the ${maxBytes} limit`
            );
        }
        return { status: response.status, body, etag };
    } catch (cause) {
        if (cause instanceof RegistryError) throw cause;
        const reason = cause instanceof Error ? cause.message : String(cause);
        throw unavailable(`Cannot reach ${url}: ${reason}`, [
            'Check your network connection, or run with `--offline` to use the cache',
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

/** Joins a registry base URL with a path, tolerating a trailing slash either way. */
export const joinUrl = (base: string, path: string): string =>
    /^[a-z][a-z0-9+.-]*:/i.test(path)
        ? path
        : `${base.replace(/\/+$/, '')}/${path.replace(/^\/+/, '')}`;
