import {
    DIAGNOSTIC_CODES,
    type Diagnostic,
    error as errorDiagnostic,
    type MergeStrategy,
} from '@atarashi/schema';
import type { RenderContext } from '../context.js';
import { evaluateCondition } from '../expr/index.js';
import type { BlueprintGraph, GraphNode } from '../types.js';
import { normalizeProjectPath, resolveDotfileNames } from '../write/paths.js';
import { DEFAULT_FILE_MODE } from '../write/vfs.js';
import { createEngine, renderString } from './engine.js';

export interface FileFragment {
    path: string;
    contents: string | Buffer;
    mode: number;
    merge: MergeStrategy;
    source: string;
    /** Graph position of the contributing blueprint — the merge tiebreaker. */
    order: number;
}

export interface SlotContribution {
    target: string;
    slot: string;
    value: string;
    source: string;
    order: number;
}

export interface RenderOutput {
    fragments: FileFragment[];
    slots: SlotContribution[];
    diagnostics: Diagnostic[];
}

/**
 * Merge defaults by convention, so blueprints only declare `merge` when they
 * want something other than the obvious thing for that kind of file. Anything
 * unrecognised defaults to `error`: two blueprints silently overwriting each
 * other is the failure mode this whole design exists to prevent.
 */
export function defaultMergeFor(path: string): MergeStrategy {
    const name = path.split('/').pop() ?? path;

    if (name === 'package.json' || name === 'tsconfig.json' || path.startsWith('.vscode/')) {
        return 'json-deep';
    }
    if (name.startsWith('.env')) return 'env';
    if (name === '.gitignore' || name === '.dockerignore' || name === '.npmrc') {
        return 'lines-unique';
    }
    if (/^(docker-compose|compose)\.(ya?ml)$/.test(name) || path.startsWith('.github/workflows/')) {
        return 'yaml-deep';
    }
    return 'error';
}

/** `files/src/db/index.ts.hbs` → `src/db/index.ts`, with `_dotfile` resolved. */
export function defaultDestination(from: string): string {
    const withoutRoot = from.replace(/^files\//, '');
    const withoutTemplateSuffix = withoutRoot.replace(/\.hbs$/, '');
    return resolveDotfileNames(withoutTemplateSuffix);
}

const isBinaryPath = (path: string): boolean =>
    /\.(ico|png|jpe?g|gif|webp|avif|woff2?|ttf|otf|eot|pdf|zip|gz|tgz|jar|wasm|mp[34]|webm)$/i.test(
        path
    );

async function renderBlueprint(node: GraphNode, context: RenderContext): Promise<RenderOutput> {
    const { manifest } = node.blueprint;
    const fragments: FileFragment[] = [];
    const slots: SlotContribution[] = [];
    const diagnostics: Diagnostic[] = [];

    for (const entry of manifest.files) {
        const where = `${manifest.id}:${entry.from}`;

        if (!evaluateCondition(entry.when, context)) continue;

        const destination = normalizeProjectPath(
            renderString(entry.to ?? defaultDestination(entry.from), context, where)
        );

        const bytes = await node.blueprint.readFile(entry.from);
        const binary = !entry.render || isBinaryPath(destination);

        const contents = binary
            ? bytes
            : createEngine(where, entry.escape, destination).render(
                  bytes.toString('utf8'),
                  context
              );

        fragments.push({
            path: destination,
            contents,
            mode: entry.mode ? Number.parseInt(entry.mode, 8) : DEFAULT_FILE_MODE,
            merge: entry.merge ?? defaultMergeFor(destination),
            source: manifest.id,
            order: node.order,
        });
    }

    for (const contribution of manifest.contributions) {
        if (!evaluateCondition(contribution.when, context)) continue;

        const target = normalizeProjectPath(
            renderString(contribution.target, context, `${manifest.id}:contribution`)
        );

        if ('slot' in contribution) {
            slots.push({
                target,
                slot: contribution.slot,
                value: renderString(
                    contribution.value,
                    context,
                    `${manifest.id}:${contribution.slot}`
                ),
                source: manifest.id,
                order: node.order,
            });
            continue;
        }

        // A structured contribution is a fragment like any other; the merger
        // does not care that it came from the manifest rather than a template.
        fragments.push({
            path: target,
            contents: JSON.stringify(contribution.value, null, 2),
            mode: DEFAULT_FILE_MODE,
            merge: contribution.merge,
            source: manifest.id,
            order: node.order,
        });
    }

    return { fragments, slots, diagnostics };
}

/**
 * Renders every blueprint in the graph. Blueprints are rendered in parallel —
 * they cannot see each other's output, so there is nothing to serialize — but
 * results are reassembled in graph order so merging stays deterministic.
 */
export async function render(graph: BlueprintGraph, context: RenderContext): Promise<RenderOutput> {
    const settled = await Promise.allSettled(
        graph.nodes.map((node) => renderBlueprint(node, context))
    );

    const fragments: FileFragment[] = [];
    const slots: SlotContribution[] = [];
    const diagnostics: Diagnostic[] = [];

    settled.forEach((result, index) => {
        const id = graph.nodes[index]!.blueprint.manifest.id;
        if (result.status === 'rejected') {
            diagnostics.push(
                errorDiagnostic(
                    DIAGNOSTIC_CODES.RENDER_FAILED,
                    `${id} failed to render: ${(result.reason as Error).message}`,
                    { blueprints: [id] }
                )
            );
            return;
        }
        fragments.push(...result.value.fragments);
        slots.push(...result.value.slots);
        diagnostics.push(...result.value.diagnostics);
    });

    return { fragments, slots, diagnostics };
}
