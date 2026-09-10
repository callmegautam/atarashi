import { expectPlan, fileAt, hasFile, planToSnapshot, specForPreset } from '@atarashi/testing';
import { describe, expect, it } from 'vitest';
import { catalogue, EXPECTED_PRESETS } from './catalogue.js';

const ANSWERS = { 'db.name': 'my_app' };

describe.each(EXPECTED_PRESETS)('%s', (id) => {
    it('generates a complete project', async () => {
        const spec = await specForPreset(catalogue, id, {
            name: 'my-app',
            description: 'A generated project',
            answers: ANSWERS,
            author: { name: 'Ada Lovelace', email: 'ada@example.com' },
        });

        const plan = await expectPlan(catalogue, spec);

        expect(plan.conflicts).toEqual([]);
        await expect(planToSnapshot(plan)).toMatchFileSnapshot(
            `./__snapshots__/presets/${id.replace('preset/', '')}.txt`
        );
    });
});

describe('every preset', () => {
    it.each(EXPECTED_PRESETS)(
        '%s names the project after the user, not the template',
        async (id) => {
            const spec = await specForPreset(catalogue, id, {
                name: 'ledger-api',
                answers: ANSWERS,
            });
            const plan = await expectPlan(catalogue, spec);
            const packageJson = JSON.parse(fileAt(plan, 'package.json')) as { name: string };

            expect(packageJson.name).toBe('ledger-api');
        }
    );

    it.each(EXPECTED_PRESETS)('%s records how it was generated', async (id) => {
        const spec = await specForPreset(catalogue, id, { name: 'ledger-api', answers: ANSWERS });
        const plan = await expectPlan(catalogue, spec);

        expect(hasFile(plan, 'atarashi.json')).toBe(true);
        const config = JSON.parse(fileAt(plan, 'atarashi.json')) as { preset?: string };
        expect(config.preset).toBe(id);
    });

    it.each(EXPECTED_PRESETS)('%s leaves no DEMO placeholder behind', async (id) => {
        const spec = await specForPreset(catalogue, id, { name: 'ledger-api', answers: ANSWERS });
        const plan = await expectPlan(catalogue, spec);

        for (const file of plan.files) {
            if (file.binary || typeof file.contents !== 'string') continue;
            expect(file.contents, `${file.path}`).not.toMatch(/=DEMO\b/);
        }
    });
});
