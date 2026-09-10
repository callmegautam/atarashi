import { randomBytes } from 'node:crypto';
import {
    type DependencyEntry,
    DIAGNOSTIC_CODES,
    type Diagnostic,
    type EnvEntry,
    error,
    type JsonValue,
    type ProjectSpec,
    warning,
} from '@atarashi/schema';
import type { RenderContext } from '../context.js';
import { evaluateCondition } from '../expr/index.js';
import type { EnvEntryFragment } from '../merge/text.js';
import { renderString } from '../render/engine.js';
import type { FileFragment } from '../render/renderer.js';
import type { BlueprintGraph } from '../types.js';
import { DEFAULT_FILE_MODE } from '../write/vfs.js';

export interface Collected {
    /** Synthetic fragments for `package.json`, `.env.example` and `.gitignore`. */
    fragments: FileFragment[];
    dependencies: DependencyEntry[];
    devDependencies: DependencyEntry[];
    env: EnvEntryFragment[];
    nextSteps: string[];
    diagnostics: Diagnostic[];
}

type DependencySpec = string | { version?: string; when?: string; fromVersionManifest?: boolean };

/**
 * A fresh value for an env entry that declares `generate`. `.env` is gitignored
 * and per-machine, so a random signing key there is the difference between a
 * project that boots on the first try and one that stops on a validation error.
 */
function generateEnvValue(kind: NonNullable<EnvEntry['generate']>): string {
    switch (kind) {
        case 'hex-32':
            return randomBytes(32).toString('hex');
        case 'hex-64':
            return randomBytes(64).toString('hex');
        case 'base64url-32':
            return randomBytes(32).toString('base64url');
    }
}

const renderEnvBlock = (entries: EnvEntryFragment[]): string =>
    `${entries
        .flatMap((entry) => [
            ...(entry.description ? [`# ${entry.description}`] : []),
            `${entry.key}=${entry.value}`,
        ])
        .join('\n')}\n`;

/**
 * Doc 09 § T3. The version manifest is a reviewed, PR-gated file, and for a
 * trusted blueprint it is a convenience: pin your own range if you have a
 * reason, and the conformance suite will point it out.
 *
 * For an untrusted blueprint — anything from npm or a third-party registry — it
 * is a gate. Without this, `atarashi add npm:atarashi-blueprint-x` could pull
 * any package at any version into the user's project, which is the same
 * supply-chain vector as an install script and needs the same answer.
 */
function refuseUnreviewedDependency(
    name: string,
    source: string,
    diagnostics: Diagnostic[]
): undefined {
    diagnostics.push(
        error(
            DIAGNOSTIC_CODES.SCHEMA_INVALID,
            `\`${source}\` is not trusted and wants \`${name}\`, which the registry does not pin`,
            {
                blueprints: [source],
                suggestions: [
                    `Only packages in the reviewed version manifest may come from an untrusted blueprint`,
                    'Vendor the blueprint into `./.atarashi/blueprints` after reading what it does',
                ],
            }
        )
    );
    return undefined;
}

function resolveRange(
    name: string,
    spec: DependencySpec,
    versions: Record<string, string>,
    context: RenderContext,
    diagnostics: Diagnostic[],
    source: string,
    trusted: boolean
): string | undefined {
    const pinned = versions[name];

    if (typeof spec === 'string') {
        if (pinned) return pinned;
        return trusted ? spec : refuseUnreviewedDependency(name, source, diagnostics);
    }
    if (!evaluateCondition(spec.when, context)) return undefined;

    if (spec.fromVersionManifest !== false && pinned) return pinned;
    if (!trusted) return refuseUnreviewedDependency(name, source, diagnostics);
    if (spec.version) return spec.version;

    diagnostics.push(
        warning(
            DIAGNOSTIC_CODES.SCHEMA_INVALID,
            `${source} declares \`${name}\` with no version and the registry pins none; falling back to \`*\``,
            { blueprints: [source] }
        )
    );
    return '*';
}

/**
 * Turns each blueprint's declarative contributions — dependencies, scripts, env
 * vars, gitignore lines, next steps — into ordinary fragments, so they go
 * through exactly the same merge machinery as templated files. There is no
 * second code path for "declared" content.
 */
export function collect(
    spec: ProjectSpec,
    graph: BlueprintGraph,
    context: RenderContext,
    versions: Record<string, string> = {}
): Collected {
    const diagnostics: Diagnostic[] = [];
    const fragments: FileFragment[] = [];
    const dependencies = new Map<string, DependencyEntry>();
    const devDependencies = new Map<string, DependencyEntry>();
    const env: EnvEntryFragment[] = [];
    const nextSteps: string[] = [];

    for (const node of graph.nodes) {
        const { manifest } = node.blueprint;
        const packageJson: Record<string, JsonValue> = {};

        for (const [field, target] of [
            ['dependencies', dependencies],
            ['devDependencies', devDependencies],
        ] as const) {
            const declared = manifest[field] as Record<string, DependencySpec>;
            const resolved: Record<string, JsonValue> = {};

            for (const name of Object.keys(declared).sort()) {
                const range = resolveRange(
                    name,
                    declared[name]!,
                    versions,
                    context,
                    diagnostics,
                    manifest.id,
                    node.blueprint.trusted
                );
                if (range === undefined) continue;

                resolved[name] = range;
                const existing = target.get(name);
                target.set(name, {
                    name,
                    range,
                    dev: field === 'devDependencies',
                    requestedBy: [...(existing?.requestedBy ?? []), manifest.id],
                });
            }

            if (Object.keys(resolved).length > 0) packageJson[field] = resolved;
        }

        const scripts: Record<string, JsonValue> = {};
        for (const name of Object.keys(manifest.scripts).sort()) {
            const script = manifest.scripts[name]!;
            if (typeof script === 'string') {
                scripts[name] = renderString(script, context, `${manifest.id}:scripts.${name}`);
                continue;
            }
            if (!evaluateCondition(script.when, context)) continue;
            scripts[name] = renderString(script.value, context, `${manifest.id}:scripts.${name}`);
        }
        if (Object.keys(scripts).length > 0) packageJson.scripts = scripts;

        if (Object.keys(packageJson).length > 0) {
            fragments.push({
                path: 'package.json',
                contents: JSON.stringify(packageJson, null, 2),
                mode: DEFAULT_FILE_MODE,
                merge: 'json-deep',
                source: manifest.id,
                order: node.order,
            });
        }

        const blueprintEnv: EnvEntryFragment[] = [];
        // `.env` differs from `.env.example` only where an entry declares
        // `generate`, so the two bodies are built side by side.
        const blueprintDotEnv: EnvEntryFragment[] = [];
        for (const entry of manifest.env) {
            if (!evaluateCondition(entry.when, context)) continue;
            const sample = renderString(entry.sample, context, `${manifest.id}:env`);
            const collected: EnvEntryFragment = {
                key: entry.key,
                // A secret ships with an empty value: `.env.example` is committed.
                value: entry.secret ? '' : sample,
                source: manifest.id,
            };
            if (entry.description) collected.description = entry.description;
            blueprintEnv.push(collected);
            env.push(collected);
            blueprintDotEnv.push(
                entry.generate
                    ? { ...collected, value: generateEnvValue(entry.generate) }
                    : collected
            );
        }

        // Env vars become ordinary `env`-strategy fragments, so a key declared
        // twice with different values conflicts through the same machinery as
        // any other file.
        if (blueprintEnv.length > 0) {
            const body = renderEnvBlock(blueprintEnv);
            fragments.push({
                path: '.env.example',
                contents: body,
                mode: DEFAULT_FILE_MODE,
                merge: 'env',
                source: manifest.id,
                order: node.order,
            });
            if (spec.options.writeEnv) {
                fragments.push({
                    path: '.env',
                    contents: renderEnvBlock(blueprintDotEnv),
                    mode: DEFAULT_FILE_MODE,
                    merge: 'env',
                    source: manifest.id,
                    order: node.order,
                });
            }
        }

        if (manifest.gitignore.length > 0) {
            fragments.push({
                path: '.gitignore',
                contents: `${manifest.gitignore.join('\n')}\n`,
                mode: DEFAULT_FILE_MODE,
                merge: 'lines-unique',
                source: manifest.id,
                order: node.order,
            });
        }

        for (const step of manifest.nextSteps) {
            const rendered = renderString(step, context, `${manifest.id}:nextSteps`);
            if (!nextSteps.includes(rendered)) nextSteps.push(rendered);
        }
    }

    // The project's own identity always wins over anything a blueprint declares —
    // this is what stops every generated project being named "configs".
    const identity: Record<string, JsonValue> = {
        name: context.project.slug,
        version: '0.1.0',
        private: true,
        type: 'module',
    };
    if (spec.description) identity.description = spec.description;
    if (spec.options.license) identity.license = spec.options.license;
    if (spec.options.author?.name) {
        const { name, email, url } = spec.options.author;
        identity.author = [name, email ? `<${email}>` : null, url ? `(${url})` : null]
            .filter(Boolean)
            .join(' ');
    }

    fragments.push({
        path: 'package.json',
        contents: JSON.stringify(identity, null, 2),
        mode: DEFAULT_FILE_MODE,
        merge: 'json-deep',
        source: 'atarashi',
        // Last in graph order, so it overrides every blueprint's own idea of
        // the project's name.
        order: graph.nodes.length + 1,
    });

    return {
        fragments,
        dependencies: [...dependencies.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
        devDependencies: [...devDependencies.values()].sort((a, b) => (a.name < b.name ? -1 : 1)),
        env,
        nextSteps,
        diagnostics,
    };
}
