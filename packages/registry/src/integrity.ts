import { createHash, timingSafeEqual } from 'node:crypto';
import type { JsonValue, RegistryIndex } from '@atarashi/schema';
import { integrityFailure } from './errors.js';

export type HashAlgorithm = 'sha256' | 'sha384' | 'sha512';

const SRI = /^(sha256|sha384|sha512)-([A-Za-z0-9+/]+={0,2})$/;

/** Subresource-integrity style digest: `sha256-<base64>`. */
export function digest(data: Buffer | string, algorithm: HashAlgorithm = 'sha256'): string {
    return `${algorithm}-${createHash(algorithm).update(data).digest('base64')}`;
}

/** The hex form, used for content-addressed directory names. */
export function hexDigest(data: Buffer | string, algorithm: HashAlgorithm = 'sha256'): string {
    return createHash(algorithm).update(data).digest('hex');
}

export function parseIntegrity(value: string): { algorithm: HashAlgorithm; base64: string } {
    const match = SRI.exec(value);
    if (!match) {
        throw integrityFailure(`\`${value}\` is not a valid integrity digest`);
    }
    return { algorithm: match[1] as HashAlgorithm, base64: match[2]! };
}

/**
 * A mismatch is a hard failure that names the artifact — never a silent
 * fallback to an unverified copy (doc 09, T4).
 */
export function verifyIntegrity(data: Buffer, expected: string, what: string): void {
    const { algorithm } = parseIntegrity(expected);
    const actual = digest(data, algorithm);

    const a = Buffer.from(actual);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw integrityFailure(
            `Integrity check failed for ${what}`,
            `expected ${expected}, computed ${actual}`
        );
    }
}

/**
 * Deterministic JSON: object keys sorted, no incidental whitespace. Two
 * machines must produce the same bytes for the same document, or the root hash
 * is meaningless.
 */
export function canonicalize(value: JsonValue | unknown): string {
    if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null);
    if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;

    const entries = Object.entries(value as Record<string, unknown>)
        .filter(([, v]) => v !== undefined)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, v]) => `${JSON.stringify(key)}:${canonicalize(v)}`);
    return `{${entries.join(',')}}`;
}

/** The index's root hash covers its entries and its version manifest. */
export function indexRootHash(
    index: Pick<RegistryIndex, 'entries' | 'versionManifest' | 'version' | 'indexVersion'>
): string {
    return digest(
        canonicalize({
            indexVersion: index.indexVersion,
            version: index.version,
            entries: index.entries,
            versionManifest: index.versionManifest ?? null,
        })
    );
}

export function verifyIndexIntegrity(index: RegistryIndex, source: string): void {
    if (!index.integrity) return; // Unsigned local mirrors are allowed; remote ones are not.
    const actual = indexRootHash(index);
    if (actual !== index.integrity) {
        throw integrityFailure(
            `Registry index ${index.version} failed its root hash check (${source})`,
            `expected ${index.integrity}, computed ${actual}`
        );
    }
}
