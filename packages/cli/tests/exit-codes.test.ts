import { DIAGNOSTIC_CODES } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { EXIT, exitCodeFor } from '../src/exit-codes.js';

describe('exitCodeFor', () => {
    it('maps a resolution failure to EXIT.RESOLUTION', () => {
        expect(exitCodeFor(DIAGNOSTIC_CODES.CAPABILITY_CONFLICT)).toBe(EXIT.RESOLUTION);
    });

    it('maps a merge conflict to EXIT.MERGE_CONFLICT', () => {
        expect(exitCodeFor(DIAGNOSTIC_CODES.MERGE_CONFLICT)).toBe(EXIT.MERGE_CONFLICT);
    });

    it('maps a filesystem refusal to EXIT.FS_REFUSAL', () => {
        expect(exitCodeFor(DIAGNOSTIC_CODES.TARGET_NOT_EMPTY)).toBe(EXIT.FS_REFUSAL);
    });

    it('maps a registry failure to EXIT.REGISTRY', () => {
        expect(exitCodeFor(DIAGNOSTIC_CODES.REGISTRY_UNAVAILABLE)).toBe(EXIT.REGISTRY);
    });

    it('falls back to EXIT.RUNTIME for an unmapped code', () => {
        expect(exitCodeFor('ATA_SOMETHING_NEW')).toBe(EXIT.RUNTIME);
    });
});
