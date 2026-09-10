import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalogue } from '@atarashi/testing';

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const catalogue = new Catalogue(ROOT);

/** The v1 catalogue, exactly as promised in doc 02 and the release checklist. */
export const EXPECTED_IDS = [
    'auth/jwt',
    'auth/session',
    'ci/github',
    'ci/gitlab',
    'core/node-js',
    'core/node-ts',
    'db/mongodb',
    'db/mysql',
    'db/postgres',
    'db/sqlite',
    'http/express',
    'http/fastify',
    'http/hono',
    'infra/docker',
    'infra/docker-compose',
    'lint/biome',
    'lint/eslint-prettier',
    'meta/editorconfig',
    'meta/husky',
    'meta/license',
    'meta/readme',
    'mw/cors',
    'mw/error-handler',
    'mw/helmet',
    'mw/rate-limit',
    'obs/morgan-logger',
    'obs/pino',
    'orm/drizzle',
    'orm/mongoose',
    'orm/prisma',
    'test/jest',
    'test/vitest',
    'validation/zod',
    'web/angular-tailwind',
    'web/next',
    'web/react-vite-tailwind',
] as const;

export const EXPECTED_PRESETS = [
    'preset/backend-minimal',
    'preset/backend-mongo',
    'preset/backend-ts',
    'preset/frontend-only',
    'preset/fullstack-angular',
    'preset/fullstack-react',
] as const;

/**
 * The smallest graph each blueprint needs to be exercised in. Anything omitted
 * that the blueprint `requires` is auto-added by the resolver; entries here are
 * the cases where more than one blueprint provides the capability, so the
 * resolver would rightly refuse to guess.
 */
export const MATRIX: Record<string, string[]> = {
    'auth/jwt': ['core/node-ts', 'http/express'],
    'auth/session': ['core/node-ts', 'http/express'],
    'ci/github': ['core/node-ts'],
    'ci/gitlab': ['core/node-ts'],
    'core/node-js': [],
    'core/node-ts': [],
    'db/mongodb': ['core/node-ts'],
    'db/mysql': ['core/node-ts'],
    'db/postgres': ['core/node-ts'],
    'db/sqlite': ['core/node-ts'],
    'http/express': ['core/node-ts'],
    'http/fastify': ['core/node-ts'],
    'http/hono': ['core/node-ts'],
    'infra/docker': ['core/node-ts'],
    'infra/docker-compose': ['core/node-ts'],
    'lint/biome': ['core/node-ts'],
    'lint/eslint-prettier': ['core/node-ts'],
    'meta/editorconfig': ['core/node-ts'],
    'meta/husky': ['core/node-ts', 'lint/biome'],
    'meta/license': ['core/node-ts'],
    'meta/readme': ['core/node-ts'],
    'mw/cors': ['core/node-ts', 'http/express'],
    'mw/error-handler': ['core/node-ts', 'http/express'],
    'mw/helmet': ['core/node-ts', 'http/express'],
    'mw/rate-limit': ['core/node-ts', 'http/express'],
    'obs/morgan-logger': ['core/node-ts', 'http/express'],
    'obs/pino': ['core/node-ts', 'http/express'],
    'orm/drizzle': ['core/node-ts', 'db/postgres'],
    'orm/mongoose': ['core/node-ts', 'db/mongodb'],
    'orm/prisma': ['core/node-ts', 'db/postgres'],
    'test/jest': ['core/node-ts', 'http/express'],
    'test/vitest': ['core/node-ts', 'http/express'],
    'validation/zod': ['core/node-ts'],
    'web/angular-tailwind': ['core/node-ts'],
    'web/next': ['core/node-ts'],
    'web/react-vite-tailwind': ['core/node-ts'],
};

/** Answers the prompts every blueprint in the matrix could ask. */
export const MATRIX_ANSWERS = {
    'db.name': 'my_app',
    'db.pool': true,
    'auth.expiry': '7d',
};

export const compositionFor = (id: string): string[] => [...(MATRIX[id] ?? ['core/node-ts']), id];
