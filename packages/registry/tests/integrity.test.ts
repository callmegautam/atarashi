import { describe, expect, it } from 'vitest';
import { RegistryError } from '../src/errors.js';
import {
    canonicalize,
    digest,
    hexDigest,
    indexRootHash,
    parseIntegrity,
    verifyIntegrity,
} from '../src/integrity.js';

describe('T4 — digests (security boundary)', () => {
    it('produces SRI-shaped digests the schema accepts', () => {
        expect(digest('hello')).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/);
        expect(digest('hello', 'sha512').startsWith('sha512-')).toBe(true);
        expect(hexDigest('hello')).toHaveLength(64);
    });

    it('round-trips through parseIntegrity', () => {
        const value = digest('hello');
        expect(parseIntegrity(value).algorithm).toBe('sha256');
        expect(() => parseIntegrity('md5-nope')).toThrow(RegistryError);
    });

    it('names the artifact when verification fails', () => {
        const data = Buffer.from('blueprint');
        expect(() => verifyIntegrity(data, digest(data), 'db/postgres@1.0.0')).not.toThrow();
        expect(() => verifyIntegrity(data, digest('other'), 'db/postgres@1.0.0')).toThrow(
            /db\/postgres@1\.0\.0/
        );
    });

    it('rejects a digest that is the wrong shape rather than passing it through', () => {
        expect(() => verifyIntegrity(Buffer.from('x'), 'sha256-', 'thing')).toThrow(RegistryError);
    });
});

describe('canonicalize', () => {
    it('is key-order independent', () => {
        expect(canonicalize({ b: 1, a: [3, { d: 4, c: 5 }] })).toBe(
            canonicalize({ a: [3, { c: 5, d: 4 }], b: 1 })
        );
    });

    it('distinguishes documents that differ in content', () => {
        expect(canonicalize({ a: 1 })).not.toBe(canonicalize({ a: 2 }));
        expect(canonicalize([1, 2])).not.toBe(canonicalize([2, 1]));
    });

    it('drops undefined but keeps null', () => {
        expect(canonicalize({ a: undefined, b: null })).toBe('{"b":null}');
    });
});

describe('indexRootHash', () => {
    const base = {
        indexVersion: 1,
        version: '1.4.2',
        entries: [{ id: 'db/postgres', version: '1.2.0' }],
    } as never;

    it('is stable across serializations', () => {
        expect(indexRootHash(base)).toBe(indexRootHash(structuredClone(base)));
    });

    it('changes when an entry changes', () => {
        const tampered = structuredClone(base) as { entries: { version: string }[] };
        tampered.entries[0]!.version = '1.2.1';
        expect(indexRootHash(tampered as never)).not.toBe(indexRootHash(base));
    });
});
