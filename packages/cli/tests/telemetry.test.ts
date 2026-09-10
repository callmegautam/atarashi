import type { UserConfig } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { telemetryEnabled } from '../src/telemetry.js';

const optedIn: UserConfig = { telemetry: true };

/**
 * Doc 09 § T7. Off by default, and three documented kill switches that each
 * win over an opted-in config.
 */
describe('T7 — telemetry (security boundary)', () => {
    it('is off when nothing has been opted into', () => {
        expect(telemetryEnabled({}, {})).toBe(false);
    });

    it('is off when explicitly declined', () => {
        expect(telemetryEnabled({ telemetry: false }, {})).toBe(false);
    });

    it('is on only after an explicit opt-in', () => {
        expect(telemetryEnabled(optedIn, {})).toBe(true);
    });

    it.each([
        ['DO_NOT_TRACK', '1'],
        ['DO_NOT_TRACK', 'true'],
        ['ATARASHI_TELEMETRY', '0'],
        ['ATARASHI_TELEMETRY', 'false'],
        ['CI', '1'],
        ['CI', 'true'],
    ])('%s=%s overrides an opted-in config', (key, value) => {
        expect(telemetryEnabled(optedIn, { [key]: value })).toBe(false);
    });

    it('does not disable on an unrelated value', () => {
        expect(telemetryEnabled(optedIn, { DO_NOT_TRACK: '0', CI: 'false' })).toBe(true);
    });
});
