import { describe, expect, it } from 'vitest';
import {
    AtarashiError,
    blueprintIdSchema,
    capabilitySchema,
    fail,
    jsonValueSchema,
    ok,
    relativePathSchema,
    unwrap,
} from '../src/index.js';

describe('path safety', () => {
    it.each([
        '/etc/passwd',
        'C:\\Windows\\system32',
        '../outside.ts',
        'src/../../outside.ts',
        'src/\0evil.ts',
    ])('rejects %j', (path) => {
        expect(relativePathSchema.safeParse(path).success).toBe(false);
    });

    it.each(['src/index.ts', '.github/workflows/ci.yml', 'src/models/{{ answers.entity }}.ts'])(
        'accepts %j',
        (path) => {
            expect(relativePathSchema.safeParse(path).success).toBe(true);
        }
    );
});

describe('identifiers', () => {
    it.each(['db/postgres', 'mw/error-handler', 'core/node-ts'])('accepts the id %j', (id) => {
        expect(blueprintIdSchema.safeParse(id).success).toBe(true);
    });

    it.each(['postgres', 'db/', '/postgres', 'db/postgres/extra', 'DB/postgres', '1db/x'])(
        'rejects the id %j',
        (id) => {
            expect(blueprintIdSchema.safeParse(id).success).toBe(false);
        }
    );

    it.each(['database', 'database:sql', 'runtime:node'])('accepts the capability %j', (cap) => {
        expect(capabilitySchema.safeParse(cap).success).toBe(true);
    });

    it.each(['Database', 'database:', ':sql', 'data base'])('rejects the capability %j', (cap) => {
        expect(capabilitySchema.safeParse(cap).success).toBe(false);
    });
});

describe('json values', () => {
    it('accepts nested json', () => {
        expect(jsonValueSchema.safeParse({ a: [1, 'two', true, null, { b: {} }] }).success).toBe(
            true
        );
    });

    it('rejects non-json values', () => {
        expect(jsonValueSchema.safeParse(() => 1).success).toBe(false);
        expect(jsonValueSchema.safeParse(undefined).success).toBe(false);
    });
});

describe('Result', () => {
    it('carries diagnostics on success', () => {
        const result = ok(1, [{ severity: 'warning', code: 'X', message: 'heads up' }]);
        expect(result.ok && result.diagnostics).toHaveLength(1);
        expect(unwrap(result)).toBe(1);
    });

    it('serializes errors for --json without losing diagnostics', () => {
        const result = fail('ATA_X', 'boom', [
            { severity: 'error', code: 'ATA_X', message: 'boom' },
        ]);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error).toBeInstanceOf(AtarashiError);
        expect(result.error.toJSON()).toEqual({
            code: 'ATA_X',
            message: 'boom',
            diagnostics: [{ severity: 'error', code: 'ATA_X', message: 'boom' }],
        });
        expect(() => unwrap(result)).toThrow('boom');
    });
});
