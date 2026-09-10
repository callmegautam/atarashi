import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { runCreateBlueprint } from '../src/commands/create-blueprint.js';
import { EXIT } from '../src/exit-codes.js';

/**
 * The checks here mirror `packages/blueprints/tests/manifests.test.ts` — this
 * suite exists so a third-party author gets the same guarantees from
 * `atarashi create-blueprint --validate` that the first-party catalogue is
 * held to (doc 08 §3).
 */
describe('create-blueprint --validate', () => {
    let root: string;
    let dir: string;

    const manifest = (overrides: Record<string, unknown> = {}) => ({
        manifestVersion: 1,
        id: 'db/redis',
        name: 'Redis',
        version: '1.0.0',
        description: 'A redis client.',
        category: 'db',
        tags: [],
        provides: ['db:redis'],
        requires: [],
        conflicts: [],
        prompts: [],
        files: [{ from: 'files/README.md', to: 'docs/redis.md' }],
        dependencies: {},
        devDependencies: {},
        env: [],
        contributions: [],
        nextSteps: [],
        ...overrides,
    });

    const write = async (contents: Record<string, unknown>) => {
        await writeFile(join(dir, 'blueprint.json'), JSON.stringify(contents, null, 2), 'utf8');
    };

    beforeEach(async () => {
        // `<root>/blueprints/<namespace>/<name>`, matching the real bundled
        // layout — `loadVersionManifest` looks for `<root>/version-manifest.json`
        // three levels up from the blueprint directory.
        root = await mkdtemp(join(tmpdir(), 'atarashi-create-blueprint-'));
        dir = join(root, 'blueprints', 'db', 'redis');
        await mkdir(join(dir, 'files'), { recursive: true });
        await writeFile(join(dir, 'files', 'README.md'), '# redis\n', 'utf8');
        await write(manifest());
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('passes a well-formed blueprint', async () => {
        const code = await runCreateBlueprint(undefined, { validate: dir, json: true });
        expect(code).toBe(EXIT.OK);
    });

    it('fails when the id does not match the namespace/name directory', async () => {
        await write(manifest({ id: 'db/postgres' }));
        const code = await runCreateBlueprint(undefined, { validate: dir, json: true });
        expect(code).toBe(EXIT.USAGE);
    });

    it('fails on a shipped file no files[].from entry references', async () => {
        await writeFile(join(dir, 'files', 'orphan.txt'), 'unused\n', 'utf8');
        const code = await runCreateBlueprint(undefined, { validate: dir, json: true });
        expect(code).toBe(EXIT.USAGE);
    });

    it('fails when a prompt declares no non-interactive flag', async () => {
        await write(
            manifest({
                prompts: [{ name: 'db.name', type: 'input', message: 'Database name?' }],
            })
        );
        const code = await runCreateBlueprint(undefined, { validate: dir, json: true });
        expect(code).toBe(EXIT.USAGE);
    });

    it('passes a prompt that does declare a flag', async () => {
        await write(
            manifest({
                prompts: [
                    {
                        name: 'db.name',
                        type: 'input',
                        message: 'Database name?',
                        flag: '--db-name',
                    },
                ],
            })
        );
        const code = await runCreateBlueprint(undefined, { validate: dir, json: true });
        expect(code).toBe(EXIT.OK);
    });

    it('fails a dependency missing from the sibling version-manifest.json', async () => {
        await writeFile(
            join(root, 'version-manifest.json'),
            JSON.stringify({ packages: {} }),
            'utf8'
        );
        // `dependencies.ioredis` omits `version`, so it defaults to
        // version-manifest resolution — and the manifest above has none.
        await write(manifest({ dependencies: { ioredis: {} } }));
        const code = await runCreateBlueprint(undefined, { validate: dir, json: true });
        expect(code).toBe(EXIT.USAGE);
    });

    it('passes once the version-manifest.json actually pins the dependency', async () => {
        await writeFile(
            join(root, 'version-manifest.json'),
            JSON.stringify({ packages: { ioredis: '^5.0.0' } }),
            'utf8'
        );
        await write(manifest({ dependencies: { ioredis: {} } }));
        const code = await runCreateBlueprint(undefined, { validate: dir, json: true });
        expect(code).toBe(EXIT.OK);
    });

    it('skips the version-manifest check entirely when none is on disk', async () => {
        await write(manifest({ dependencies: { ioredis: {} } }));
        const code = await runCreateBlueprint(undefined, { validate: dir, json: true });
        expect(code).toBe(EXIT.OK);
    });

    it('reports "no blueprint.json" as a usage error, not a crash', async () => {
        const code = await runCreateBlueprint(undefined, {
            validate: join(root, 'nowhere'),
            json: true,
        });
        expect(code).toBe(EXIT.USAGE);
    });

    it(`accepts a trailing separator (${sep}) in the directory`, async () => {
        const code = await runCreateBlueprint(undefined, { validate: `${dir}${sep}`, json: true });
        expect(code).toBe(EXIT.OK);
    });
});
