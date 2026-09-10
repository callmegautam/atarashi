import type { ProjectConfig, ProjectSpec } from '@atarashi/schema';
import { CURRENT_SPEC_VERSION } from '@atarashi/schema';
import type { BlueprintGraph } from '../types.js';

/**
 * `atarashi.json`, the record of what produced this project. It makes
 * generation reproducible, tells `atarashi add` what is already installed, and
 * lets the web builder import an existing project's configuration.
 */
export function buildProjectConfig(
    spec: ProjectSpec,
    graph: BlueprintGraph,
    options: { atarashiVersion: string; generatedAt: string }
): ProjectConfig {
    const config: ProjectConfig = {
        $schema: 'https://unpkg.com/@atarashi/schema/schemas/atarashi.schema.json',
        specVersion: CURRENT_SPEC_VERSION,
        atarashiVersion: options.atarashiVersion,
        generatedAt: options.generatedAt,
        name: spec.name,
        blueprints: graph.nodes.map((node) => ({
            id: node.blueprint.manifest.id,
            version: node.blueprint.manifest.version,
        })),
        // Sorted so a re-run produces a byte-identical file.
        answers: Object.fromEntries(
            Object.entries(spec.answers).sort(([a], [b]) => (a < b ? -1 : 1))
        ),
        options: spec.options,
    };

    if (spec.description) config.description = spec.description;
    if (spec.preset) config.preset = spec.preset;
    if (spec.registry) config.registry = spec.registry;

    return config;
}

export const serializeProjectConfig = (config: ProjectConfig): string =>
    `${JSON.stringify(config, null, 2)}\n`;
