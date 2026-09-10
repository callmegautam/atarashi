import { describe, expect, it } from 'vitest';
import {
    blueprintManifestSchema,
    parseBlueprintManifest,
    parseManifest,
    parsePresetManifest,
    presetManifestSchema,
} from '../src/index.js';
import { validBlueprint, validPreset } from './fixtures.js';

describe('blueprint manifest', () => {
    it('accepts the reference manifest and applies defaults', () => {
        const result = parseBlueprintManifest(validBlueprint());
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.id).toBe('db/postgres');
        expect(result.value.kind).toBe('blueprint');
        expect(result.value.author).toBe('atarashi');
        expect(result.value.license).toBe('MIT');
        expect(result.value.experimental).toBe(false);
        expect(result.value.optionalPeers).toEqual([]);
        expect(result.value.files[0]?.render).toBe(true);
    });

    it.each([
        ['a bare id with no namespace', { id: 'postgres' }],
        ['an uppercase id', { id: 'db/Postgres' }],
        ['a non-semver version', { version: '1.0' }],
        ['a capability with bad syntax', { provides: ['Database SQL'] }],
        ['a priority above the cap', { priority: 5000 }],
        ['an absolute file destination', { files: [{ from: 'files/a.ts', to: '/etc/passwd' }] }],
        ['a traversing file destination', { files: [{ from: 'files/a.ts', to: '../../evil.ts' }] }],
        ['a non-octal mode', { files: [{ from: 'files/a.ts', mode: '999x' }] }],
        ['a lowercase env key', { env: [{ key: 'database_url', sample: '' }] }],
    ])('rejects %s', (_label, patch) => {
        const result = parseBlueprintManifest({ ...validBlueprint(), ...patch });
        expect(result.ok).toBe(false);
    });

    it('rejects unknown top-level keys so typos surface at load time', () => {
        const result = parseBlueprintManifest({ ...validBlueprint(), dependancies: {} });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.diagnostics.some((d) => d.message.includes('dependancies'))).toBe(true);
    });

    it('rejects a select prompt with no choices', () => {
        const manifest = validBlueprint();
        manifest.prompts = [{ name: 'db.kind', type: 'select', message: 'Kind' } as never];
        const result = parseBlueprintManifest(manifest);
        expect(result.ok).toBe(false);
    });

    it('rejects duplicate prompt names inside one blueprint', () => {
        const manifest = validBlueprint();
        manifest.prompts = [
            { name: 'db.name', type: 'input', message: 'a' },
            { name: 'db.name', type: 'input', message: 'b' },
        ] as never;
        const result = parseBlueprintManifest(manifest);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(
            result.error.diagnostics.some((d) => d.message.includes('duplicate prompt name'))
        ).toBe(true);
    });

    it('rejects a blueprint that requires a token it also conflicts with', () => {
        const result = parseBlueprintManifest({
            ...validBlueprint(),
            requires: ['database'],
            conflicts: ['database'],
        });
        expect(result.ok).toBe(false);
    });

    it('allows providing and conflicting on the same token (only-one-of pattern)', () => {
        const result = parseBlueprintManifest(validBlueprint());
        expect(result.ok).toBe(true);
    });

    it('accepts conditional dependencies and scripts', () => {
        const result = parseBlueprintManifest({
            ...validBlueprint(),
            dependencies: {
                postgres: { version: '^3.4.0', when: "answers.driver === 'postgresjs'" },
            },
            scripts: { 'db:push': { value: 'drizzle-kit push', when: "has('orm/drizzle')" } },
        });
        expect(result.ok).toBe(true);
    });

    it('reports a manifest from a future Atarashi as an upgrade, not a parse failure', () => {
        const result = parseBlueprintManifest({ ...validBlueprint(), manifestVersion: 99 });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_MANIFEST_VERSION_UNSUPPORTED');
        expect(result.error.message).toContain('newer than this version of Atarashi');
        expect(result.error.diagnostics[0]?.suggestions?.[0]).toContain('Upgrade Atarashi');
    });

    it('reports a missing manifestVersion before anything else', () => {
        const { manifestVersion: _drop, ...rest } = validBlueprint();
        const result = parseBlueprintManifest(rest);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_MANIFEST_VERSION_UNSUPPORTED');
    });

    it('exposes the raw zod schema for consumers that want their own error shape', () => {
        expect(blueprintManifestSchema.safeParse(validBlueprint()).success).toBe(true);
    });
});

describe('preset manifest', () => {
    it('accepts the reference preset', () => {
        const result = parsePresetManifest(validPreset());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.version).toBe('1.0.0');
        expect(result.value.blueprints).toHaveLength(3);
    });

    it('rejects a preset id outside the preset namespace', () => {
        expect(parsePresetManifest({ ...validPreset(), id: 'backend-ts' }).ok).toBe(false);
    });

    it('rejects a preset with no blueprints', () => {
        expect(parsePresetManifest({ ...validPreset(), blueprints: [] }).ok).toBe(false);
    });

    it('is reachable through parseManifest by kind', () => {
        expect(parseManifest(validPreset()).ok).toBe(true);
        expect(parseManifest(validBlueprint()).ok).toBe(true);
        expect(presetManifestSchema.safeParse(validPreset()).success).toBe(true);
    });
});
