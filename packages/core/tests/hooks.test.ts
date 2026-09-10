import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { blueprintManifestSchema } from '@atarashi/schema';
import { describe, expect, it } from 'vitest';
import { generate } from '../src/generate.js';
import type { HookConsent } from '../src/hooks/types.js';
import type { LoadedBlueprint } from '../src/types.js';
import { FakeSource, specFor } from './source.js';

const tempDir = () => mkdtemp(join(tmpdir(), 'atarashi-hooks-'));

interface HookedInput {
    id: string;
    /** The `hooks.js` source. */
    hookSource?: string;
    /** Blueprint-relative template contents, served by `readFile`. */
    templates?: Record<string, string>;
    trusted?: boolean;
    capabilities?: ('read-files' | 'write-files' | 'read-context')[];
    exports?: ('beforeRender' | 'afterRender' | 'afterPlan')[];
    timeoutMs?: number;
    /** Skip writing `hooks.js`, to exercise the missing-module path. */
    omitModule?: boolean;
    moduleName?: string;
    /** Any other manifest field, in its pre-parse form. */
    [field: string]: unknown;
}

/**
 * A blueprint that really exists on disk — hooks are loaded by the Node module
 * loader, so an in-memory fixture cannot exercise them.
 */
async function hookedBlueprint(input: HookedInput): Promise<LoadedBlueprint> {
    const dir = await tempDir();
    const moduleName = input.moduleName ?? 'hooks.js';
    const templates = input.templates ?? {};

    if (!input.omitModule && input.hookSource) {
        await writeFile(join(dir, moduleName), input.hookSource, 'utf8');
    }

    const {
        hookSource: _source,
        templates: _templates,
        trusted,
        capabilities,
        exports,
        timeoutMs,
        omitModule: _omit,
        moduleName: _name,
        ...rest
    } = input;

    const manifest = blueprintManifestSchema.parse({
        manifestVersion: 1,
        name: input.id,
        version: '1.0.0',
        description: `Hooked ${input.id}`,
        category: 'test',
        hooks: {
            module: `./${moduleName}`,
            exports: exports ?? ['afterPlan'],
            capabilities: capabilities ?? [],
            ...(timeoutMs ? { timeoutMs } : {}),
        },
        ...rest,
    });

    return {
        manifest,
        origin: `dir:${dir}`,
        dir,
        trusted: trusted ?? true,
        async readFile(path: string) {
            const contents = templates[path];
            if (contents === undefined) throw new Error(`${input.id} has no file \`${path}\``);
            return Buffer.from(contents, 'utf8');
        },
    };
}

/** Every hooked blueprint also contributes one file, so the plan is valid. */
const withIndexFile = (id: string) => ({
    files: [{ from: 'files/index.ts.hbs', to: `${id.split('/')[1]}.ts` }],
});

const run = async (
    blueprint: LoadedBlueprint,
    options: Parameters<typeof generate>[1]['hooks'] = {}
) =>
    generate(specFor([blueprint.manifest.id]) as never, {
        source: new FakeSource().addLoaded(blueprint),
        atarashiVersion: '1.0.0',
        now: () => new Date('2026-01-01T00:00:00.000Z'),
        hooks: options,
    });

describe('afterPlan', () => {
    it('runs the doc 05 example: a hook that adds a warning', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            capabilities: ['read-context'],
            hookSource: `
                export function afterPlan(plan, ctx) {
                    plan.warnings.push({
                        severity: 'warning',
                        code: 'ATA_CUSTOM',
                        message: 'generated for ' + ctx.project.name,
                    });
                    plan.nextSteps.push('Read the hook’s note');
                }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok).toBe(true);
        if (!result.ok) return;

        expect(result.value.warnings).toContainEqual({
            severity: 'warning',
            code: 'ATA_CUSTOM',
            message: 'generated for my-api',
        });
        expect(result.value.summary.nextSteps).toContain('Read the hook’s note');
    });

    it('accepts a hook that returns the plan instead of mutating it', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            hookSource: `
                export function afterPlan(plan) {
                    return { ...plan, nextSteps: [...plan.nextSteps, 'returned'] };
                }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok && result.value.summary.nextSteps).toContain('returned');
    });

    it('drops rubbish a hook puts in `warnings` rather than trusting it', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            hookSource: `
                export function afterPlan(plan) {
                    plan.warnings.push('not a diagnostic');
                    plan.warnings.push({ severity: 'warning', code: 'OK', message: 'kept' });
                }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.warnings.some((entry) => entry.code === 'OK')).toBe(true);
        expect(result.value.warnings).not.toContain('not a diagnostic');
    });
});

describe('capabilities', () => {
    const fileWritingHook = `
        export function afterPlan(plan) {
            plan.files.push({
                path: 'HOOKED.md',
                contents: '# written by a hook\\n',
                mode: 0o644,
                sources: ['core/node-ts'],
                binary: false,
            });
        }
    `;

    it('applies file changes when `write-files` is declared', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            capabilities: ['read-files', 'write-files'],
            hookSource: fileWritingHook,
        });

        const result = await run(blueprint);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.files.map((file) => file.path)).toContain('HOOKED.md');
        expect(result.value.summary.fileCount).toBe(result.value.files.length);
    });

    it('refuses file changes without `write-files`, and says so', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            capabilities: ['read-files'],
            hookSource: fileWritingHook,
        });

        const result = await run(blueprint);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.files.map((file) => file.path)).not.toContain('HOOKED.md');
        expect(result.value.warnings.some((entry) => /write-files/.test(entry.message))).toBe(true);
    });

    it('hides the file list without `read-files`', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            hookSource: `
                export function afterPlan(plan) {
                    plan.nextSteps.push('saw ' + plan.files.length + ' files');
                }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok && result.value.summary.nextSteps).toContain('saw 0 files');
    });

    it('hides the context without `read-context`', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            hookSource: `
                export function afterPlan(plan, ctx) {
                    plan.nextSteps.push('ctx is ' + typeof ctx);
                }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok && result.value.summary.nextSteps).toContain('ctx is undefined');
    });

    it('rebuilds `has` and `provides` inside the worker', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            provides: ['runtime:node'],
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            capabilities: ['read-context'],
            hookSource: `
                export function afterPlan(plan, ctx) {
                    plan.nextSteps.push(
                        'has=' + ctx.has('core/node-ts') + ' provides=' + ctx.provides('runtime:node')
                    );
                }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok && result.value.summary.nextSteps).toContain('has=true provides=true');
    });
});

describe('beforeRender', () => {
    it('lets a hook derive an answer that templates then use', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            files: [{ from: 'files/index.ts.hbs', to: 'index.ts' }],
            exports: ['beforeRender'],
            hookSource: `
                export function beforeRender(input) {
                    input.answers['core.greeting'] = 'derived';
                }
            `,
        });
        // The template lives in the blueprint's own readFile map.
        const withTemplate: LoadedBlueprint = {
            ...blueprint,
            readFile: async () =>
                Buffer.from('export const greeting = "{{ answers.[core.greeting] }}";\n'),
        };

        const result = await run(withTemplate);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(
            result.value.files.find((file) => file.path === 'index.ts')?.contents.toString()
        ).toBe('export const greeting = "derived";\n');
    });
});

describe('afterRender', () => {
    it('sees the merged tree and can rewrite it', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            files: [{ from: 'files/index.ts.hbs', to: 'index.ts' }],
            exports: ['afterRender'],
            capabilities: ['read-files', 'write-files'],
            hookSource: `
                export function afterRender(rendered) {
                    for (const file of rendered.files) {
                        if (file.path === 'index.ts') file.contents = '// rewritten\\n';
                    }
                }
            `,
        });
        const withTemplate: LoadedBlueprint = {
            ...blueprint,
            readFile: async () => Buffer.from('export {};\n'),
        };

        const result = await run(withTemplate);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(
            result.value.files.find((file) => file.path === 'index.ts')?.contents.toString()
        ).toBe('// rewritten\n');
    });
});

// Security boundary (doc 09, T2). A hook is exactly as trusted as the blueprint
// that shipped it, and even a trusted one gets no filesystem and no network.
describe('T2 — the hook sandbox (security boundary)', () => {
    const denied = async (source: string) => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            hookSource: source,
        });
        return run(blueprint);
    };

    it('refuses `node:fs`', async () => {
        const result = await denied(`
            import { writeFileSync } from 'node:fs';
            export function afterPlan() { writeFileSync('/tmp/pwned', 'x'); }
        `);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/may not import `node:fs`/);
    });

    it('refuses `node:child_process`', async () => {
        const result = await denied(`
            import { execSync } from 'node:child_process';
            export function afterPlan() { execSync('id'); }
        `);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/may not import `node:child_process`/);
    });

    it('allows the pure builtins on the allowlist', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            hookSource: `
                import { posix } from 'node:path';
                export function afterPlan(plan) {
                    plan.nextSteps.push(posix.join('a', 'b'));
                }
            `,
        });
        expect((await run(blueprint)).ok).toBe(true);
    });

    it('refuses to import anything outside the blueprint directory', async () => {
        const dir = await tempDir();
        await writeFile(join(dir, 'outside.js'), 'export const secret = 1;\n', 'utf8');
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            hookSource: `
                import { secret } from ${JSON.stringify(join(dir, 'outside.js'))};
                export function afterPlan(plan) { plan.nextSteps.push(String(secret)); }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/from outside the blueprint/);
    });

    it('gives the hook an empty environment and no `fetch`', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            hookSource: `
                export function afterPlan(plan) {
                    plan.nextSteps.push(
                        'env=' + Object.keys(process.env).length + ' fetch=' + typeof fetch
                    );
                }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok && result.value.summary.nextSteps).toContain('env=0 fetch=undefined');
    });

    it('kills a hook that never returns', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            timeoutMs: 200,
            hookSource: `
                export function afterPlan() { while (true) {} }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/timed out after 200ms/);
    });

    it('re-validates paths a hook writes, so it cannot escape the target', async () => {
        const blueprint = await hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            capabilities: ['read-files', 'write-files'],
            hookSource: `
                export function afterPlan(plan) {
                    plan.files.push({
                        path: '../../.ssh/authorized_keys',
                        contents: 'ssh-rsa AAA',
                        mode: 0o644,
                        sources: ['core/node-ts'],
                        binary: false,
                    });
                }
            `,
        });

        const result = await run(blueprint);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.code).toBe('ATA_PATH_ESCAPE');
    });

    it('reports a hook that throws, and says how to generate without it', async () => {
        const result = await denied(`
            export function afterPlan() { throw new Error('boom'); }
        `);
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/boom/);
        expect(
            result.error.diagnostics.some((entry) =>
                entry.suggestions?.includes('Run with `--no-hooks` to generate without it')
            )
        ).toBe(true);
    });
});

describe('T2 — hook trust and consent (security boundary)', () => {
    const untrusted = () =>
        hookedBlueprint({
            id: 'core/node-ts',
            ...withIndexFile('core/node-ts'),
            templates: { 'files/index.ts.hbs': 'export {};\n' },
            trusted: false,
            capabilities: ['read-context'],
            hookSource: `
                export function afterPlan(plan) { plan.nextSteps.push('ran'); }
            `,
        });

    it('skips an untrusted blueprint’s hooks when no consent is offered', async () => {
        const result = await run(await untrusted());
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.summary.nextSteps).not.toContain('ran');
        expect(
            result.value.warnings.some((entry) => /not from a trusted source/.test(entry.message))
        ).toBe(true);
    });

    it('runs them once consent is granted, and shows what was asked for', async () => {
        const asked: Parameters<HookConsent>[0][] = [];
        const consent: HookConsent = (request) => {
            asked.push(request);
            return true;
        };

        const result = await run(await untrusted(), { consent });
        expect(result.ok && result.value.summary.nextSteps).toContain('ran');
        expect(asked[0]?.capabilities).toEqual(['read-context']);
        expect(asked[0]?.hook).toBe('afterPlan');
    });

    it('honours a refusal', async () => {
        const result = await run(await untrusted(), { consent: () => false });
        expect(result.ok && result.value.summary.nextSteps).not.toContain('ran');
    });

    it('skips every hook under --no-hooks, and degrades rather than failing', async () => {
        const result = await run(await untrusted(), { enabled: false });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.value.summary.nextSteps).not.toContain('ran');
    });
});

describe('malformed hook declarations', () => {
    const base = {
        id: 'core/node-ts',
        ...withIndexFile('core/node-ts'),
        templates: { 'files/index.ts.hbs': 'export {};\n' },
    };

    it('reports a missing module', async () => {
        const result = await run(
            await hookedBlueprint({ ...base, omitModule: true, hookSource: 'export {};' })
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/hook module `\.\/hooks\.js` is missing/);
    });

    it('refuses a TypeScript hook module', async () => {
        const result = await run(
            await hookedBlueprint({
                ...base,
                moduleName: 'hooks.ts',
                hookSource: 'export function afterPlan() {}',
            })
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/must be JavaScript/);
    });

    it('reports a module that does not export the declared hook', async () => {
        const result = await run(
            await hookedBlueprint({ ...base, hookSource: 'export function somethingElse() {}' })
        );
        expect(result.ok).toBe(false);
        if (result.ok) return;
        expect(result.error.message).toMatch(/exports no `afterPlan` function/);
    });

    it('skips hooks for a blueprint with no directory on disk', async () => {
        const source = new FakeSource();
        const blueprint = await hookedBlueprint({
            ...base,
            hookSource: 'export function afterPlan(plan) { plan.nextSteps.push("ran"); }',
        });
        source.addLoaded({ ...blueprint, dir: undefined });

        const result = await generate(specFor(['core/node-ts']) as never, {
            source,
            atarashiVersion: '1.0.0',
        });
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(
            result.value.warnings.some((entry) => /not loaded from a directory/.test(entry.message))
        ).toBe(true);
    });
});
