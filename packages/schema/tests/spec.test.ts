import { describe, expect, it } from 'vitest';
import {
    CURRENT_SPEC_VERSION,
    parseProjectConfig,
    parseProjectSpec,
    projectNameSchema,
} from '../src/index.js';
import { validSpec } from './fixtures.js';

describe('project spec', () => {
    it('accepts a spec and fills option defaults', () => {
        const result = parseProjectSpec(validSpec());
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.options.format).toBe(true);
        expect(result.value.options.license).toBe('MIT');
        expect(result.value.options.force).toBe(false);
        expect(result.value.options.writeEnv).toBe(false);
        expect(result.value.blueprints[0]?.reason).toBe('user');
        expect(result.value.blueprints[1]?.reason).toBe('auto');
    });

    it('accepts a spec with no targetDir, as the web builder posts', () => {
        const { targetDir: _drop, ...rest } = validSpec();
        expect(parseProjectSpec(rest).ok).toBe(true);
    });

    it.each([
        ['My API', 'uppercase'],
        ['my api', 'a space'],
        ['', 'empty'],
        ['.hidden', 'a leading dot'],
    ])('rejects the project name %j (%s)', (name) => {
        expect(projectNameSchema.safeParse(name).success).toBe(false);
    });

    it('accepts scoped project names', () => {
        expect(projectNameSchema.safeParse('@acme/my-api').success).toBe(true);
    });

    it('rejects an unknown package manager', () => {
        const spec = validSpec();
        spec.options = { ...spec.options, packageManager: 'cargo' } as never;
        expect(parseProjectSpec(spec).ok).toBe(false);
    });

    it('rejects unknown top-level keys', () => {
        expect(parseProjectSpec({ ...validSpec(), blueprint: [] }).ok).toBe(false);
    });

    it('rejects a spec version this build predates', () => {
        const result = parseProjectSpec({ ...validSpec(), specVersion: CURRENT_SPEC_VERSION + 1 });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_SPEC_VERSION_UNSUPPORTED');
    });
});

describe('atarashi.json', () => {
    const config = () => ({
        specVersion: 1,
        atarashiVersion: '1.0.0',
        registry: { version: '1.4.2', integrity: 'sha256-abc123==' },
        generatedAt: '2026-09-07T00:00:00.000Z',
        name: 'my-api',
        blueprints: [
            { id: 'core/node-ts', version: '1.0.0' },
            { id: 'db/postgres', version: '1.2.0' },
        ],
        answers: { 'db.name': 'my_api', 'db.usePool': true },
        options: { packageManager: 'pnpm', git: true },
    });

    it('accepts the reference config', () => {
        const result = parseProjectConfig(config());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.blueprints).toHaveLength(2);
        expect(result.value.options.packageManager).toBe('pnpm');
    });

    it('requires an exact version per recorded blueprint, so regeneration is reproducible', () => {
        const bad = config();
        bad.blueprints = [{ id: 'core/node-ts' }] as never;
        expect(parseProjectConfig(bad).ok).toBe(false);
    });

    it('rejects a non-ISO generatedAt', () => {
        expect(parseProjectConfig({ ...config(), generatedAt: 'yesterday' }).ok).toBe(false);
    });

    it('names the file it failed on', () => {
        const result = parseProjectConfig({ ...config(), name: 'Nope Nope' });
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toContain('atarashi.json');
    });
});
