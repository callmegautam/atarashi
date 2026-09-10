import type {
    Conflict,
    Diagnostic,
    GenerationPlan,
    PlannedFile,
    PostAction,
    ProjectSpec,
} from '@atarashi/schema';
import type { RenderContext } from '../context.js';
import type { BlueprintGraph } from '../types.js';
import type { VirtualFileSystem } from '../write/vfs.js';
import type { Collected } from './collect.js';
import { buildProjectConfig, serializeProjectConfig } from './config.js';

export interface AssembleInput {
    spec: ProjectSpec;
    graph: BlueprintGraph;
    context: RenderContext;
    files: VirtualFileSystem;
    collected: Collected;
    conflicts: Conflict[];
    warnings: Diagnostic[];
}

/**
 * Post-actions in the fixed order from doc 03. Each is emitted even when the
 * user turned it off, carrying `skipped` and a reason, so the CLI can report
 * "skipped install (--no-install)" rather than silently doing nothing.
 */
function buildActions(spec: ProjectSpec, context: RenderContext): PostAction[] {
    const { options } = spec;
    const pm = context.pm;

    const action = (
        kind: PostAction['kind'],
        label: string,
        enabled: boolean,
        skipReason: string,
        command?: { command: string; args: string[] }
    ): PostAction => ({
        kind,
        label,
        skipped: !enabled,
        ...(enabled ? {} : { skipReason }),
        ...(command ?? {}),
        args: command?.args ?? [],
    });

    const [installBin, ...installArgs] = pm.install.split(' ') as [string, ...string[]];

    return [
        action('git-init', 'Initialising a git repository', options.git, '--no-git', {
            command: 'git',
            args: ['init', '-b', 'main'],
        }),
        action(
            'install',
            `Installing dependencies with ${pm.name}`,
            options.install,
            '--no-install',
            { command: installBin, args: installArgs }
        ),
        action(
            'format',
            'Formatting with the project’s own formatter',
            options.format,
            '--no-format'
        ),
        action(
            'git-commit',
            'Creating the first commit',
            options.git && options.initialCommit,
            options.git ? '--no-initial-commit' : '--no-git',
            { command: 'git', args: ['commit', '-m', 'chore: scaffold with atarashi'] }
        ),
    ];
}

/**
 * Turns the merged virtual filesystem into the finished `GenerationPlan`.
 *
 * `atarashi.json` is added here rather than by a post-action, so that a
 * dry run, the web preview, the zip download and a snapshot test all show the
 * exact same file set the writer will produce — the plan really is the whole
 * output.
 */
export function assemblePlan(input: AssembleInput): GenerationPlan {
    const { spec, graph, context, files, collected } = input;

    const config = buildProjectConfig(spec, graph, {
        atarashiVersion: context.atarashi.version,
        generatedAt: context.atarashi.generatedAt,
    });
    files.set('atarashi.json', serializeProjectConfig(config), { sources: ['atarashi'] });

    const planned: PlannedFile[] = files.list().map((file) => ({
        path: file.path,
        contents: file.contents,
        mode: file.mode,
        sources: file.sources,
        binary: file.binary,
    }));

    const nextSteps = [
        ...(spec.options.install ? [] : [`Install dependencies:  ${context.pm.install}`]),
        ...collected.nextSteps,
    ];
    if (collected.env.some((entry) => entry.value === '')) {
        nextSteps.push('Fill in the blank values in `.env.example` and copy it to `.env`');
    }

    return {
        specVersion: spec.specVersion,
        files: planned,
        conflicts: input.conflicts,
        actions: buildActions(spec, context),
        warnings: input.warnings,
        summary: {
            fileCount: planned.length,
            totalBytes: files.totalBytes(),
            deps: {
                dependencies: collected.dependencies,
                devDependencies: collected.devDependencies,
            },
            blueprints: graph.nodes.map((node) => ({
                id: node.blueprint.manifest.id,
                version: node.blueprint.manifest.version,
            })),
            nextSteps,
        },
    };
}
