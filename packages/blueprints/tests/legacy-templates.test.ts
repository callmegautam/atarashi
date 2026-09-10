import { expectPlan, fileAt, hasFile, makeSpec, planToSnapshot } from '@atarashi/testing';
import { describe, expect, it } from 'vitest';
import { catalogue } from './catalogue.js';

/**
 * The four v0.6 templates, recomposed from blueprints. These are the
 * reproductions doc 10 asks for: each one has to cover everything the original
 * folder did, and the snapshot is where "better than the original" is argued.
 */
const REPRODUCTIONS = {
    'backend-pgsql': {
        blueprints: [
            'core/node-ts',
            'validation/zod',
            'db/postgres',
            'orm/drizzle',
            'http/express',
            'mw/cors',
            'mw/error-handler',
            'obs/morgan-logger',
            'auth/jwt',
            'infra/docker',
            'lint/eslint-prettier',
            'meta/readme',
            'meta/license',
        ],
        expects: [
            'src/app.ts',
            'src/config/env.ts',
            'src/db/client.ts',
            'src/db/schema.ts',
            'src/lib/jwt.ts',
            'src/lib/password.ts',
            'src/middlewares/auth.ts',
            'src/middlewares/error-handler.ts',
            'drizzle.config.ts',
            'Dockerfile',
        ],
    },
    'backend-mysql': {
        blueprints: [
            'core/node-ts',
            'validation/zod',
            'db/mysql',
            'orm/drizzle',
            'http/express',
            'mw/cors',
            'mw/error-handler',
            'obs/morgan-logger',
            'auth/jwt',
            'infra/docker',
            'lint/eslint-prettier',
            'meta/readme',
            'meta/license',
        ],
        expects: ['src/db/client.ts', 'src/db/schema.ts', 'drizzle.config.ts'],
    },
    'backend-mongo': {
        blueprints: [
            'core/node-ts',
            'validation/zod',
            'db/mongodb',
            'orm/mongoose',
            'http/express',
            'mw/cors',
            'mw/error-handler',
            'obs/morgan-logger',
            'auth/jwt',
            'infra/docker',
            'lint/eslint-prettier',
            'meta/readme',
            'meta/license',
        ],
        expects: ['src/db/index.ts', 'src/models/user.ts', 'src/lib/jwt.ts'],
    },
    'angular-tailwind': {
        blueprints: ['core/node-ts', 'web/angular-tailwind', 'meta/readme', 'meta/editorconfig'],
        expects: [
            'angular.json',
            'src/main.ts',
            'src/app/app.ts',
            'src/app/app.html',
            'src/styles.css',
            'public/favicon.ico',
            '.editorconfig',
        ],
    },
} as const;

describe.each(Object.entries(REPRODUCTIONS))('the %s template, recomposed', (name, setup) => {
    const spec = () =>
        makeSpec([...setup.blueprints], {
            name,
            answers: { 'db.name': 'my_app', 'db.pool': true, 'auth.expiry': '7d' },
        });

    it('produces every file the original had a counterpart for', async () => {
        const plan = await expectPlan(catalogue, spec());
        for (const path of setup.expects) {
            expect(hasFile(plan, path), `${name}: missing ${path}`).toBe(true);
        }
    });

    it('matches its snapshot', async () => {
        const plan = await expectPlan(catalogue, spec());
        await expect(planToSnapshot(plan)).toMatchFileSnapshot(
            `./__snapshots__/legacy/${name}.txt`
        );
    });
});

describe('the drift the old templates carried', () => {
    it('has one canonical async handler, not two spellings', async () => {
        const plan = await expectPlan(
            catalogue,
            makeSpec(['core/node-ts', 'http/express'], { answers: {} })
        );
        const paths = plan.files.map((file) => file.path);

        expect(paths).toContain('src/lib/async-handler.ts');
        expect(paths).not.toContain('src/lib/asyncHandler.ts');
    });

    it('never names a generated project after the template', async () => {
        const plan = await expectPlan(
            catalogue,
            makeSpec(['core/node-ts', 'http/express'], { name: 'ledger-api' })
        );
        const packageJson = fileAt(plan, 'package.json');

        expect(packageJson).not.toContain('"configs"');
        expect(JSON.parse(packageJson).name).toBe('ledger-api');
    });

    it('takes the license from the spec rather than hardcoding ISC', async () => {
        const plan = await expectPlan(
            catalogue,
            makeSpec(['core/node-ts', 'meta/license'], { license: 'MIT' })
        );

        expect(JSON.parse(fileAt(plan, 'package.json')).license).toBe('MIT');
        expect(fileAt(plan, 'LICENSE')).toContain('MIT License');
    });

    it('fills .env.example with usable values instead of DEMO', async () => {
        const plan = await expectPlan(
            catalogue,
            makeSpec(['core/node-ts', 'http/express', 'db/postgres', 'auth/jwt'], {
                name: 'ledger-api',
                answers: { 'db.name': 'ledger', 'auth.expiry': '30m' },
            })
        );
        const env = fileAt(plan, '.env.example');

        expect(env).toContain('DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ledger');
        expect(env).toContain('JWT_EXPIRES_IN=30m');
        expect(env).toContain('JWT_SECRET=');
        expect(env).not.toContain('DEMO');
    });

    it('resolves the package manager instead of pinning pnpm@10.11.1', async () => {
        const plan = await expectPlan(
            catalogue,
            makeSpec(['core/node-ts', 'http/express'], { packageManager: 'npm' })
        );

        expect(fileAt(plan, 'package.json')).not.toContain('pnpm@');
        expect(plan.summary.nextSteps.join('\n')).not.toContain('pnpm');
    });
});
