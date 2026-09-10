import { expectPlan, makeSpec, planToSnapshot } from '@atarashi/testing';
import { describe, expect, it } from 'vitest';
import { catalogue, MATRIX_ANSWERS } from './catalogue.js';

/**
 * The combinations the e2e matrix boots (doc 08 §5) that no preset covers.
 * Presets get their own full-filesystem snapshots; these are the hand-built
 * compositions — a second HTTP framework, a second ORM, the JavaScript path —
 * where the interesting bugs are merges between blueprints that were each fine
 * on their own. Keeping the two sets aligned means every scenario e2e runs has
 * a snapshot a human reviewed first.
 */
const COMPOSITIONS = {
    'fastify-sqlite-drizzle': [
        'core/node-ts',
        'http/fastify',
        'db/sqlite',
        'orm/drizzle',
        'validation/zod',
        'test/vitest',
        'lint/biome',
    ],
    'hono-mysql-prisma': ['core/node-ts', 'http/hono', 'db/mysql', 'orm/prisma', 'validation/zod'],
    'express-javascript': ['core/node-js', 'http/express', 'mw/cors', 'mw/error-handler'],
    'express-jwt-vitest': [
        'core/node-ts',
        'http/express',
        'auth/jwt',
        'validation/zod',
        'db/sqlite',
        'orm/drizzle',
        'test/vitest',
    ],
} as const;

describe.each(Object.entries(COMPOSITIONS))('%s', (name, ids) => {
    it('generates a complete project', async () => {
        const plan = await expectPlan(
            catalogue,
            makeSpec([...ids], {
                name: 'my-app',
                description: 'A generated project',
                answers: MATRIX_ANSWERS,
                author: { name: 'Ada Lovelace', email: 'ada@example.com' },
            })
        );

        expect(plan.conflicts).toEqual([]);
        await expect(planToSnapshot(plan)).toMatchFileSnapshot(
            `./__snapshots__/compositions/${name}.txt`
        );
    });

    it('produces no warnings that need explaining', async () => {
        const plan = await expectPlan(catalogue, makeSpec([...ids], { answers: MATRIX_ANSWERS }));
        const warnings = plan.warnings
            .filter((diagnostic) => diagnostic.severity === 'warning')
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);

        expect(warnings).toEqual([]);
    });

    it('leaves no DEMO placeholder behind', async () => {
        const plan = await expectPlan(catalogue, makeSpec([...ids], { answers: MATRIX_ANSWERS }));

        for (const file of plan.files) {
            if (file.binary || typeof file.contents !== 'string') continue;
            expect(file.contents, `${file.path}`).not.toMatch(/=DEMO\b/);
        }
    });
});
