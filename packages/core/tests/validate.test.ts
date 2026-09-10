import type { GenerationPlan, PlannedFile } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, MAX_TOTAL_BYTES, validatePlan } from '../src/plan/validate.js';

const file = (
    path: string,
    contents: string | Buffer,
    sources = ['core/node-ts']
): PlannedFile => ({
    path,
    contents,
    mode: 0o644,
    sources,
    binary: Buffer.isBuffer(contents),
});

const planOf = (files: PlannedFile[]): GenerationPlan => ({
    specVersion: 1,
    files,
    conflicts: [],
    actions: [],
    warnings: [],
    summary: {
        fileCount: files.length,
        totalBytes: 0,
        deps: { dependencies: [], devDependencies: [] },
        blueprints: [],
        nextSteps: [],
    },
});

const validate = (files: PlannedFile[], declared: string[] = []) =>
    validatePlan(planOf(files), new Set(declared));

const codes = (files: PlannedFile[], declared: string[] = []) =>
    validate(files, declared).map((diagnostic) => diagnostic.code);

describe('validatePlan', () => {
    it('passes a plan that is fine', () => {
        expect(validate([file('src/index.ts', 'export {};\n')])).toEqual([]);
    });

    it('rejects a plan with no files at all', () => {
        expect(codes([])).toContain('ATA_SCHEMA_INVALID');
    });

    it('rejects a single file past the per-file cap', () => {
        const diagnostics = validate([file('big.bin', 'x'.repeat(MAX_FILE_BYTES + 1))]);
        expect(diagnostics[0]?.code).toBe('ATA_FILE_TOO_LARGE');
        expect(diagnostics[0]?.message).toMatch(/past the 5 MB cap/);
        expect(diagnostics[0]?.path).toBe('big.bin');
    });

    it('measures buffers by byte length, not string length', () => {
        const contents = Buffer.alloc(MAX_FILE_BYTES + 1, 0);
        expect(codes([file('big.bin', contents)])).toContain('ATA_FILE_TOO_LARGE');
    });

    it('rejects a project past the total cap even when each file is fine', () => {
        const chunk = 'x'.repeat(MAX_FILE_BYTES - 1);
        const files = Array.from(
            { length: Math.ceil(MAX_TOTAL_BYTES / chunk.length) + 1 },
            (_, i) => file(`chunk-${i}.txt`, chunk)
        );
        const diagnostics = validate(files);
        expect(diagnostics.some((entry) => /generated project is/.test(entry.message))).toBe(true);
    });

    it('catches paths that differ only by case, naming both', () => {
        const diagnostics = validate([file('README.md', 'a'), file('readme.md', 'b')]);
        expect(diagnostics[0]?.code).toBe('ATA_PATH_CASE_COLLISION');
        expect(diagnostics[0]?.message).toMatch(/`readme\.md` and `README\.md`/);
    });

    it('does not flag the same path twice', () => {
        expect(codes([file('README.md', 'a'), file('README.md', 'b')])).toEqual([]);
    });

    // The renderer normalizes paths already; this is the backstop for a plan
    // assembled by hand, or by a hook.
    it('catches an escaping path that never went through the renderer', () => {
        expect(codes([file('../outside.txt', 'x')])).toContain('ATA_PATH_ESCAPE');
        expect(codes([file('/etc/passwd', 'x')])).toContain('ATA_PATH_ESCAPE');
    });

    describe('generated syntax', () => {
        it('rejects invalid JSON, quoting the parser', () => {
            const diagnostics = validate([file('package.json', '{ "name": }')]);
            expect(diagnostics[0]?.code).toBe('ATA_INVALID_GENERATED_JSON');
            expect(diagnostics[0]?.message).toMatch(/not valid JSON/);
        });

        it('accepts valid JSON', () => {
            expect(codes([file('package.json', '{ "name": "my-api" }')])).toEqual([]);
        });

        it('rejects invalid YAML in both extensions', () => {
            expect(codes([file('compose.yml', 'services: [api, ')])).toContain(
                'ATA_INVALID_GENERATED_JSON'
            );
            expect(codes([file('.github/workflows/ci.yaml', 'on: "push')])).toContain(
                'ATA_INVALID_GENERATED_JSON'
            );
        });

        it('accepts valid YAML', () => {
            expect(codes([file('compose.yml', 'services:\n  api:\n    image: node\n')])).toEqual(
                []
            );
        });

        it('skips binary files, which are copied verbatim', () => {
            expect(codes([file('logo.json', Buffer.from([0x00, 0x01]))])).toEqual([]);
        });
    });

    describe('env references', () => {
        it('warns about a variable no blueprint declares', () => {
            const diagnostics = validate([
                file('src/index.ts', 'const port = process.env.PORT;\n'),
            ]);
            expect(diagnostics[0]?.severity).toBe('warning');
            expect(diagnostics[0]?.code).toBe('ATA_UNDECLARED_ENV_KEY');
            expect(diagnostics[0]?.suggestions?.[0]).toMatch(/Add `PORT`/);
        });

        it('stays quiet once the variable is declared', () => {
            expect(codes([file('src/index.ts', 'process.env.PORT')], ['PORT'])).toEqual([]);
        });

        it('reads the bracket form too', () => {
            expect(codes([file('src/index.ts', "process.env['DATABASE_URL']")])).toContain(
                'ATA_UNDECLARED_ENV_KEY'
            );
        });

        it('reports each variable once, sorted, with the first file that used it', () => {
            const diagnostics = validate([
                file('src/b.ts', 'process.env.ZULU\n'),
                file('src/a.ts', 'process.env.ALPHA; process.env.ZULU\n'),
            ]);
            expect(diagnostics.map((entry) => entry.path)).toEqual(['src/a.ts', 'src/b.ts']);
            expect(diagnostics.map((entry) => entry.message)).toEqual([
                '`src/a.ts` reads `process.env.ALPHA`, which no blueprint declares',
                '`src/b.ts` reads `process.env.ZULU`, which no blueprint declares',
            ]);
        });

        it('only scans source files', () => {
            expect(codes([file('README.md', 'set process.env.PORT before booting')])).toEqual([]);
        });
    });
});
