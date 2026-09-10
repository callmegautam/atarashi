import { blueprintSnapshot, expectPlan, makeSpec } from '@atarashi/testing';
import { describe, expect, it } from 'vitest';
import { catalogue, compositionFor, EXPECTED_IDS, MATRIX_ANSWERS } from './catalogue.js';

/**
 * Every blueprint, generated in the smallest graph that makes sense for it.
 * The snapshot covers what that blueprint alone contributed, so a change to a
 * neighbour never churns an unrelated file.
 */
describe.each(EXPECTED_IDS)('%s', (id) => {
    it('generates, and contributes what it says it does', async () => {
        const plan = await expectPlan(
            catalogue,
            makeSpec(compositionFor(id), { answers: MATRIX_ANSWERS })
        );

        expect(plan.conflicts).toEqual([]);
        await expect(blueprintSnapshot(plan, id)).toMatchFileSnapshot(
            `./__snapshots__/matrix/${id.replace('/', '__')}.txt`
        );
    });
});

describe('the composed project', () => {
    it.each(EXPECTED_IDS)('%s produces no warnings that need explaining', async (id) => {
        const plan = await expectPlan(
            catalogue,
            makeSpec(compositionFor(id), { answers: MATRIX_ANSWERS })
        );

        const warnings = plan.warnings
            .filter((diagnostic) => diagnostic.severity === 'warning')
            .map((diagnostic) => `${diagnostic.code}: ${diagnostic.message}`);

        expect(warnings).toEqual([]);
    });
});
