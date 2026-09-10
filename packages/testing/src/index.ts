import type { GenerationPlan } from '@atarashi/schema';

// The catalogue, spec builders and plan assertions are the public authoring
// harness; internal tests use the same implementation third-party authors get.
export {
    Catalogue,
    dependencyRange,
    expectPlan,
    FIXED_NOW,
    FIXED_VERSION,
    fileAt,
    hasFile,
    makeSpec,
    planFor,
    type SpecOptions,
    specForPreset,
} from '@atarashi/plugin-kit';

const divider = '─'.repeat(72);

/**
 * A stable textual rendering of a plan. Snapshotting this rather than the raw
 * object keeps the diff readable: a reviewer sees the generated source, not a
 * serialized structure.
 */
export function planToSnapshot(plan: GenerationPlan): string {
    const lines: string[] = [];

    lines.push('# blueprints');
    for (const blueprint of plan.summary.blueprints) {
        lines.push(`  ${blueprint.id}@${blueprint.version}`);
    }

    lines.push('', '# dependencies');
    for (const entry of plan.summary.deps.dependencies) {
        lines.push(`  ${entry.name}@${entry.range}  (${entry.requestedBy.join(', ')})`);
    }
    lines.push('', '# devDependencies');
    for (const entry of plan.summary.deps.devDependencies) {
        lines.push(`  ${entry.name}@${entry.range}  (${entry.requestedBy.join(', ')})`);
    }

    if (plan.warnings.length > 0) {
        lines.push('', '# warnings');
        for (const warning of [...plan.warnings]
            .filter((diagnostic) => diagnostic.severity === 'warning')
            .sort((a, b) => (a.message < b.message ? -1 : 1))) {
            lines.push(`  ${warning.code}: ${warning.message}`);
        }
    }

    lines.push('', '# next steps');
    for (const step of plan.summary.nextSteps) lines.push(`  ${step}`);

    lines.push('', '# files');
    for (const file of plan.files) lines.push(`  ${file.path}`);

    for (const file of plan.files) {
        lines.push('', divider, `FILE ${file.path}  (${file.mode.toString(8)})`, divider);
        lines.push(
            file.binary
                ? `<binary, ${(file.contents as Buffer).byteLength} bytes>`
                : (file.contents as string).replace(/\n$/, '')
        );
    }

    return `${lines.join('\n')}\n`;
}

/**
 * Just the part of a plan one blueprint is responsible for: the files it
 * contributed to and the packages it asked for. This is what a per-blueprint
 * snapshot should cover — the rest belongs to the composition.
 */
export function blueprintSnapshot(plan: GenerationPlan, id: string): string {
    const lines: string[] = [`# ${id}`, '', '# dependencies'];

    for (const entry of [...plan.summary.deps.dependencies, ...plan.summary.deps.devDependencies]
        .filter((entry) => entry.requestedBy.includes(id))
        .sort((a, b) => (a.name < b.name ? -1 : 1))) {
        lines.push(`  ${entry.dev ? 'dev ' : '    '}${entry.name}@${entry.range}`);
    }

    const owned = plan.files.filter((file) => file.sources.includes(id));

    lines.push('', '# files');
    for (const file of owned) lines.push(`  ${file.path}  [${file.sources.join(', ')}]`);

    for (const file of owned) {
        lines.push('', divider, `FILE ${file.path}  (${file.mode.toString(8)})`, divider);
        lines.push(
            file.binary
                ? `<binary, ${(file.contents as Buffer).byteLength} bytes>`
                : (file.contents as string).replace(/\n$/, '')
        );
    }

    return `${lines.join('\n')}\n`;
}
