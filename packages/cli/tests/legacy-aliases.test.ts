import { describe, expect, it } from 'vitest';
import { resolveLegacyPreset } from '../src/legacy-aliases.js';

describe('resolveLegacyPreset', () => {
    it('passes an unrecognized name through untouched', () => {
        expect(resolveLegacyPreset('backend-ts')).toEqual({
            preset: 'backend-ts',
            add: [],
            remove: [],
        });
    });

    it('maps backend-pgsql to backend-ts, which already carries that stack', () => {
        const result = resolveLegacyPreset('backend-pgsql');
        expect(result.preset).toBe('backend-ts');
        expect(result.add).toEqual([]);
        expect(result.remove).toEqual([]);
        expect(result.notice).toContain('backend-ts');
    });

    it('drops what the target preset already provides when swapping a database', () => {
        // Without the removal this resolves to two databases and a conflict.
        const result = resolveLegacyPreset('backend-mysql');
        expect(result.preset).toBe('backend-ts');
        expect(result.add).toEqual(['db/mysql']);
        expect(result.remove).toEqual(['db/postgres']);
        expect(result.notice).toContain('--remove db/postgres');
    });

    it('swaps both the database and its ORM for backend-mongo', () => {
        const result = resolveLegacyPreset('backend-mongo');
        expect(result.add).toEqual(['db/mongodb', 'orm/mongoose']);
        expect(result.remove).toEqual(['db/postgres', 'orm/drizzle']);
    });

    it('maps angular-tailwind to fullstack-angular with no extra blueprints', () => {
        expect(resolveLegacyPreset('angular-tailwind')).toEqual(
            expect.objectContaining({ preset: 'fullstack-angular', add: [], remove: [] })
        );
    });
});
