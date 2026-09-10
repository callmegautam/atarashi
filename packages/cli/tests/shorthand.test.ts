import { describe, expect, it } from 'vitest';
import { CliUsageError } from '../src/errors.js';
import { expandShorthand } from '../src/shorthand.js';

describe('expandShorthand', () => {
    it('maps each shorthand to its blueprint id', () => {
        const { add } = expandShorthand({
            http: 'fastify',
            db: 'mysql',
            orm: 'drizzle',
            auth: 'jwt',
            ci: 'github',
            tests: 'jest',
            lint: 'biome',
        });
        expect(add).toEqual([
            'http/fastify',
            'db/mysql',
            'orm/drizzle',
            'auth/jwt',
            'ci/github',
            'test/jest',
            'lint/biome',
        ]);
    });

    it('"none" adds nothing', () => {
        const { add } = expandShorthand({ db: 'none', orm: 'none' });
        expect(add).toEqual([]);
    });

    it('--docker / --no-docker toggle infra/docker', () => {
        expect(expandShorthand({ docker: true }).add).toEqual(['infra/docker']);
        expect(expandShorthand({ docker: false }).remove).toEqual(['infra/docker']);
    });

    it('rejects an unavailable runtime', () => {
        expect(() => expandShorthand({ runtime: 'bun' })).toThrow(CliUsageError);
    });

    it('rejects a value outside the documented set', () => {
        expect(() => expandShorthand({ db: 'redis' })).toThrow(CliUsageError);
    });
});
