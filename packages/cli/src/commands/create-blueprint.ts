import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { BlueprintSource } from '@atarashi/core';
import { generate } from '@atarashi/core';
import { validateBlueprint } from '@atarashi/plugin-kit';
import { DirectorySource, loadBlueprintDir } from '@atarashi/registry';
import { BLUEPRINT_ID_PATTERN, CURRENT_SPEC_VERSION } from '@atarashi/schema';
import { buildEngineDeps } from '../engine.js';
import { CliUsageError, reportError } from '../errors.js';
import { EXIT } from '../exit-codes.js';
import { Printer } from '../output.js';

/**
 * Everything under a blueprint's grandparent directory — the layout
 * `<root>/<namespace>/<name>/blueprint.json` every first-party blueprint and
 * `create-blueprint`'s own scaffold use. Enough to smoke-test one blueprint
 * against its siblings (`core/node-ts`, `http/express`, …) without a network.
 */
class SiblingCatalogue implements BlueprintSource {
    private readonly directory: DirectorySource;

    constructor(root: string) {
        this.directory = new DirectorySource(root, { trusted: true });
    }

    load(id: string) {
        return this.directory.load(id);
    }

    async providersOf(capability: string) {
        const all = await this.directory.summaries();
        return all.filter((summary) => summary.provides.includes(capability));
    }
}

export interface CreateBlueprintFlags {
    validate?: string;
    test?: string;
    json?: boolean;
    color?: boolean;
}

function scaffold(id: string): { manifest: string; files: Record<string, string> } {
    const [namespace, name] = id.split('/');
    const manifest = {
        manifestVersion: 1,
        id,
        name: name,
        version: '1.0.0',
        description: `TODO: describe ${id}`,
        category: namespace,
        tags: [],
        provides: [],
        requires: [],
        conflicts: [],
        prompts: [],
        files: [{ from: 'files/README.md', to: `docs/${name}.md` }],
        dependencies: {},
        devDependencies: {},
        env: [],
        contributions: [],
        nextSteps: [],
    };

    return {
        manifest: `${JSON.stringify(manifest, null, 4)}\n`,
        files: { 'files/README.md': `# ${name}\n\nTODO\n` },
    };
}

/**
 * Prompt names every sibling blueprint declares. With these, an
 * `answers.x` reference to a name no blueprint defines is a hard error rather
 * than the warning a standalone blueprint has to settle for.
 */
async function siblingDeclarations(dir: string): Promise<{ prompts: string[]; envKeys: string[] }> {
    const root = join(dir, '..', '..');
    if (!existsSync(root)) return { prompts: [], envKeys: [] };
    const source = new DirectorySource(root, { trusted: true });
    const prompts: string[] = [];
    const envKeys: string[] = [];
    for (const id of await source.ids()) {
        const loaded = await source.load(id).catch(() => undefined);
        if (!loaded) continue;
        for (const prompt of loaded.manifest.prompts) prompts.push(prompt.name);
        for (const entry of loaded.manifest.env) envKeys.push(entry.key);
    }
    return { prompts, envKeys };
}

/**
 * The bundled tree is `<root>/blueprints/<namespace>/<name>`, with
 * `<root>/version-manifest.json` alongside. A third-party blueprint validated
 * standalone won't have one — the check is skipped, not failed, when absent.
 */
async function loadVersionManifest(dir: string): Promise<Record<string, string> | undefined> {
    const path = join(dir, '..', '..', '..', 'version-manifest.json');
    if (!existsSync(path)) return undefined;
    const raw = JSON.parse(await readFile(path, 'utf8')) as { packages?: Record<string, string> };
    return raw.packages ?? {};
}

async function validateAt(dir: string, printer: Printer): Promise<boolean> {
    if (!existsSync(join(dir, 'blueprint.json'))) {
        throw new CliUsageError(`No \`blueprint.json\` in ${dir}`);
    }

    const siblings = await siblingDeclarations(dir);
    const report = await validateBlueprint(dir, {
        knownPromptNames: siblings.prompts,
        knownEnvKeys: siblings.envKeys,
        versionManifest: await loadVersionManifest(dir),
    });

    for (const problem of report.problems) {
        const where = problem.path ? `${problem.path}: ` : '';
        const text = `[${problem.check}] ${where}${problem.message}`;
        if (problem.severity === 'error') printer.error(text);
        else printer.warn(text);
    }
    if (report.ok) {
        printer.success(`${report.id} — manifest, files, templates and dependencies check out`);
    }
    return report.ok;
}

/**
 * A real, if minimal, smoke test: generate a project from this blueprint
 * alone, resolved against its siblings on disk (`core/node-ts` included).
 * Assumes the standard `<root>/<namespace>/<name>` layout.
 */
async function smokeTest(dir: string, printer: Printer): Promise<boolean> {
    const parent = join(dir, '..', '..');
    const loaded = await loadBlueprintDir(dir, { trusted: true });
    const deps = buildEngineDeps(new SiblingCatalogue(parent), {
        hooks: false,
        interactive: false,
    });

    const result = await generate(
        {
            specVersion: CURRENT_SPEC_VERSION,
            name: 'blueprint-smoke-test',
            blueprints: [{ id: loaded.manifest.id, reason: 'user' }],
            answers: {},
            options: {
                packageManager: 'pnpm',
                git: false,
                install: false,
                format: false,
                initialCommit: false,
                license: 'MIT',
                author: null,
                writeEnv: false,
                force: false,
            },
        },
        deps
    );

    if (!result.ok) {
        printer.error(`generation failed: ${result.error.message}`);
        return false;
    }
    printer.success(`generated ${result.value.files.length} file(s) without error`);
    return true;
}

export async function runCreateBlueprint(
    id: string | undefined,
    flags: CreateBlueprintFlags
): Promise<number> {
    const printer = new Printer({
        json: Boolean(flags.json),
        quiet: false,
        verbose: false,
        color: flags.color !== false && !flags.json,
    });

    try {
        if (flags.validate) {
            const ok = await validateAt(flags.validate, printer);
            return ok ? EXIT.OK : EXIT.USAGE;
        }
        if (flags.test) {
            const validated = await validateAt(flags.test, printer);
            if (!validated) return EXIT.USAGE;
            const ok = await smokeTest(flags.test, printer);
            return ok ? EXIT.OK : EXIT.RUNTIME;
        }

        if (!id) throw new CliUsageError('atarashi create-blueprint <namespace/name>');
        if (!BLUEPRINT_ID_PATTERN.test(id)) {
            throw new CliUsageError(`"${id}" must look like \`namespace/name\`, e.g. "db/redis"`);
        }

        const dir = join(process.cwd(), id);
        if (existsSync(dir)) throw new CliUsageError(`${dir} already exists`);

        const { manifest, files } = scaffold(id);
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, 'blueprint.json'), manifest, 'utf8');
        for (const [path, contents] of Object.entries(files)) {
            await mkdir(join(dir, path, '..'), { recursive: true });
            await writeFile(join(dir, path), contents, 'utf8');
        }

        if (printer.options.json) printer.emitJson({ ok: true, id, dir });
        else {
            printer.success(`Scaffolded ${id} in ${dir}`);
            printer.line(`  Next:  atarashi create-blueprint --validate ${dir}`);
        }
        return EXIT.OK;
    } catch (thrown) {
        return reportError(printer, thrown);
    }
}
