import { describe, expect, it } from 'vitest';
import { parseRegistryIndex, parseUserConfig, registryEntrySchema } from '../src/index.js';

const entry = () => ({
    id: 'db/postgres',
    name: 'PostgreSQL',
    version: '1.0.0',
    description: 'PostgreSQL connection with pooling.',
    category: 'database',
    provides: ['database'],
    tarball: 'blueprints/db-postgres-1.0.0.tgz',
    integrity: 'sha256-3q2+7w==',
});

const index = () => ({
    indexVersion: 1,
    version: '1.4.2',
    updatedAt: '2026-09-07T00:00:00.000Z',
    entries: [entry()],
});

describe('registry index', () => {
    it('accepts an index and defaults the optional fields', () => {
        const result = parseRegistryIndex(index());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.entries[0]?.bundled).toBe(false);
        expect(result.value.entries[0]?.kind).toBe('blueprint');
    });

    it('requires an integrity digest on every entry', () => {
        const bad = index();
        bad.entries = [{ ...entry(), integrity: undefined }] as never;
        expect(parseRegistryIndex(bad).ok).toBe(false);
    });

    it.each([['md5-abc'], ['sha256'], ['sha256-'], ['abc123']])(
        'rejects the malformed integrity %j',
        (integrity) => {
            expect(registryEntrySchema.safeParse({ ...entry(), integrity }).success).toBe(false);
        }
    );

    it('rejects unknown top-level keys in the index', () => {
        expect(parseRegistryIndex({ ...index(), blueprints: [] }).ok).toBe(false);
    });
});

describe('user config', () => {
    it('accepts a partial config — every key is optional', () => {
        expect(parseUserConfig({}).ok).toBe(true);
        expect(parseUserConfig({ packageManager: 'bun', telemetry: false }).ok).toBe(true);
    });

    it('rejects a misspelled key rather than silently ignoring it', () => {
        expect(parseUserConfig({ packagemanager: 'bun' }).ok).toBe(false);
    });

    it('validates nested registry sources', () => {
        expect(
            parseUserConfig({
                registry: { sources: [{ name: 'acme', url: 'https://acme.dev/index.json' }] },
            }).ok
        ).toBe(true);
        expect(
            parseUserConfig({ registry: { sources: [{ name: 'acme', url: 'not-a-url' }] } }).ok
        ).toBe(false);
    });
});
