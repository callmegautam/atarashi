import { existsSync } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { blueprintManifestSchema, presetManifestSchema } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { catalogue, EXPECTED_IDS, EXPECTED_PRESETS, MATRIX, ROOT } from './catalogue.js';

const readJson = async (path: string) => JSON.parse(await readFile(path, 'utf8')) as unknown;

describe('the catalogue', () => {
    it('ships exactly the v1 blueprint set', async () => {
        expect(await catalogue.ids()).toEqual([...EXPECTED_IDS]);
    });

    it('ships exactly the v1 preset set', async () => {
        const presets = await catalogue.presets();
        expect(presets.map((preset) => preset.id).sort()).toEqual([...EXPECTED_PRESETS]);
    });

    it('has a matrix entry for every blueprint', () => {
        expect(Object.keys(MATRIX).sort()).toEqual([...EXPECTED_IDS]);
    });
});

describe.each(EXPECTED_IDS)('%s', (id) => {
    const dir = join(ROOT, 'blueprints', id);

    it('parses against the manifest schema', async () => {
        const parsed = blueprintManifestSchema.safeParse(
            await readJson(join(dir, 'blueprint.json'))
        );
        expect(parsed.success ? null : parsed.error.issues).toBeNull();
    });

    it('declares an id matching its directory', async () => {
        const manifest = blueprintManifestSchema.parse(await readJson(join(dir, 'blueprint.json')));
        expect(manifest.id).toBe(id);
    });

    it('references only files that exist', async () => {
        const manifest = blueprintManifestSchema.parse(await readJson(join(dir, 'blueprint.json')));
        for (const entry of manifest.files) {
            expect(existsSync(join(dir, entry.from)), `${id}: missing ${entry.from}`).toBe(true);
        }
    });

    it('ships no file that no manifest entry references', async () => {
        const manifest = blueprintManifestSchema.parse(await readJson(join(dir, 'blueprint.json')));
        const declared = new Set(manifest.files.map((entry) => entry.from));

        const walk = async (relative: string): Promise<string[]> => {
            const absolute = join(dir, relative);
            if (!existsSync(absolute)) return [];
            const entries = await readdir(absolute, { withFileTypes: true });
            const found: string[] = [];
            for (const entry of entries) {
                const next = `${relative}/${entry.name}`;
                if (entry.isDirectory()) found.push(...(await walk(next)));
                else found.push(next);
            }
            return found;
        };

        for (const file of await walk('files')) {
            expect(declared.has(file), `${id}: ${file} is shipped but never used`).toBe(true);
        }
    });

    it('gives every prompt a flag and a dot-scoped name', async () => {
        const manifest = blueprintManifestSchema.parse(await readJson(join(dir, 'blueprint.json')));
        for (const prompt of manifest.prompts) {
            expect(prompt.flag, `${id}: prompt ${prompt.name} has no flag`).toBeDefined();
            expect(prompt.name).toMatch(/^[a-z][a-zA-Z0-9]*\.[a-z]/);
        }
    });

    it('pins every dependency through the shared version manifest', async () => {
        const manifest = blueprintManifestSchema.parse(await readJson(join(dir, 'blueprint.json')));
        const versions = await catalogue.versionManifest();
        const names = [
            ...Object.keys(manifest.dependencies),
            ...Object.keys(manifest.devDependencies),
        ];
        for (const name of names) {
            expect(versions[name], `${id}: ${name} is not in version-manifest.json`).toBeDefined();
        }
    });
});

describe.each(EXPECTED_PRESETS)('%s', (id) => {
    it('parses and references only real blueprints', async () => {
        const file = join(ROOT, 'presets', `${id.replace('preset/', '')}.json`);
        const preset = presetManifestSchema.parse(await readJson(file));
        const ids = new Set(await catalogue.ids());

        expect(preset.id).toBe(id);
        for (const blueprint of preset.blueprints) {
            expect(ids.has(blueprint), `${id}: unknown blueprint ${blueprint}`).toBe(true);
        }
    });
});

/**
 * Doc 09 § T3 and § T5, as properties of the shipped catalogue rather than of
 * the engine. These must never be skipped.
 */
describe('T3/T5 — the catalogue (security boundary)', () => {
    const FORBIDDEN = ['preinstall', 'install', 'postinstall', 'prepare'];

    it('declares an install script only where it is reviewed and deliberate', async () => {
        // Trusted first-party blueprints may (the merger allows it, and the plan
        // shows it before anything installs) — but the set must stay small
        // enough that a reviewer can hold it in their head.
        const withInstallScripts: string[] = [];
        for (const id of await catalogue.ids()) {
            const loaded = await catalogue.load(id);
            const scripts = Object.keys(loaded?.manifest.scripts ?? {});
            if (scripts.some((name) => FORBIDDEN.includes(name))) withInstallScripts.push(id);
        }

        expect(withInstallScripts.sort()).toEqual(['meta/husky', 'orm/prisma']);
    });

    it('ignores every `.env` variant while keeping the example committable', async () => {
        // `.env` alone left `.env.local` and `.env.production` committable,
        // which is exactly the leak T5 is about.
        for (const id of ['core/node-ts', 'core/node-js']) {
            const loaded = await catalogue.load(id);
            const gitignore = loaded?.manifest.gitignore ?? [];

            expect(gitignore, id).toContain('.env*');
            expect(gitignore, id).toContain('!.env.example');
            expect(gitignore.indexOf('.env*')).toBeLessThan(gitignore.indexOf('!.env.example'));
        }
    });

    it('never ships a usable-looking value for a secret', async () => {
        for (const id of await catalogue.ids()) {
            const loaded = await catalogue.load(id);
            for (const entry of loaded?.manifest.env ?? []) {
                if (!entry.secret) continue;
                // A secret's `sample` is documentation for `.env.example`, never
                // something a reader could mistake for a working value.
                expect(entry.sample, `${id}: ${entry.key}`).not.toMatch(/^[A-Za-z0-9+/=_-]{16,}$/);
            }
        }
    });

    it('scans for committed secrets in every CI blueprint', async () => {
        for (const id of ['ci/github', 'ci/gitlab']) {
            const loaded = await catalogue.load(id);
            const files = loaded?.manifest.files ?? [];
            const contents = await Promise.all(
                files.map((file) => loaded?.readFile(file.from).then(String))
            );

            expect(contents.join('\n'), id).toMatch(/gitleaks/i);
        }
    });
});
