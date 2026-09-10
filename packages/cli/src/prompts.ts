import { type BlueprintGraph, buildContext, evaluateCondition, renderString } from '@atarashi/core';
import type { JsonValue, ProjectSpec, Prompt } from '@atarashi/schema';
import { CliUsageError } from './errors.js';

export interface DeclaredPrompt extends Prompt {
    blueprintId: string;
}

/** Every prompt in the resolved graph, deduplicated by name (first wins). */
export function collectPrompts(graph: BlueprintGraph): DeclaredPrompt[] {
    const seen = new Set<string>();
    const prompts: DeclaredPrompt[] = [];
    for (const node of graph.nodes) {
        for (const prompt of node.blueprint.manifest.prompts) {
            if (seen.has(prompt.name)) continue;
            seen.add(prompt.name);
            prompts.push({ ...prompt, blueprintId: node.blueprint.manifest.id });
        }
    }
    return prompts;
}

function coerceAnswer(prompt: Prompt, raw: string): JsonValue {
    switch (prompt.type) {
        case 'confirm': {
            const lower = raw.toLowerCase();
            if (['true', 'yes', '1'].includes(lower)) return true;
            if (['false', 'no', '0'].includes(lower)) return false;
            throw new CliUsageError(
                `${prompt.flag ?? prompt.name} expects true/false, got "${raw}"`
            );
        }
        case 'number': {
            const value = Number(raw);
            if (Number.isNaN(value)) {
                throw new CliUsageError(
                    `${prompt.flag ?? prompt.name} expects a number, got "${raw}"`
                );
            }
            return value;
        }
        case 'multiselect':
            return raw.split(',').map((entry) => entry.trim());
        default:
            return raw;
    }
}

export function validateAnswer(prompt: Prompt, value: JsonValue): void {
    if (prompt.type === 'input' && typeof value === 'string' && prompt.validate?.pattern) {
        const pattern = new RegExp(prompt.validate.pattern);
        if (!pattern.test(value)) {
            throw new CliUsageError(
                prompt.validate.message ??
                    `"${value}" is not valid for ${prompt.flag ?? prompt.name}`
            );
        }
    }
    if ((prompt.type === 'select' || prompt.type === 'multiselect') && prompt.choices) {
        const allowed = new Set(prompt.choices.map((choice) => choice.value));
        const values = Array.isArray(value) ? value : [value];
        for (const entry of values) {
            if (!allowed.has(entry as string | number | boolean)) {
                throw new CliUsageError(
                    `${prompt.flag ?? prompt.name} must be one of: ${[...allowed].join(', ')}`
                );
            }
        }
    }
}

/**
 * Matches `--<blueprint-flag> value` against the resolved graph's declared
 * prompts and returns whatever tokens matched nothing, untouched, so the
 * caller can report an unknown-flag error. `--set name=value` is the
 * always-available fallback for a prompt with no dedicated flag.
 */
export function parseDeclaredFlags(
    argv: string[],
    prompts: DeclaredPrompt[],
    setValues: string[] = []
): { answers: Record<string, JsonValue>; unknown: string[] } {
    const byFlag = new Map(
        prompts.filter((prompt) => prompt.flag).map((prompt) => [prompt.flag as string, prompt])
    );
    const byName = new Map(prompts.map((prompt) => [prompt.name, prompt]));
    const answers: Record<string, JsonValue> = {};
    const unknown: string[] = [];

    for (let index = 0; index < argv.length; index += 1) {
        const token = argv[index]!;
        const eq = token.indexOf('=');
        const flag = eq === -1 ? token : token.slice(0, eq);
        const prompt = byFlag.get(flag);

        if (!prompt) {
            unknown.push(token);
            continue;
        }

        let raw: string;
        if (eq !== -1) {
            raw = token.slice(eq + 1);
        } else if (
            prompt.type === 'confirm' &&
            (index + 1 >= argv.length || argv[index + 1]!.startsWith('--'))
        ) {
            raw = 'true';
        } else {
            raw = argv[index + 1] ?? '';
            index += 1;
        }

        const value = coerceAnswer(prompt, raw);
        validateAnswer(prompt, value);
        answers[prompt.name] = value;
    }

    for (const entry of setValues) {
        const eq = entry.indexOf('=');
        if (eq === -1) throw new CliUsageError(`--set expects name=value, got "${entry}"`);
        const name = entry.slice(0, eq);
        const raw = entry.slice(eq + 1);
        const prompt = byName.get(name);
        if (!prompt) {
            throw new CliUsageError(`--set: no prompt named "${name}" in this composition`);
        }
        const value = coerceAnswer(prompt, raw);
        validateAnswer(prompt, value);
        answers[name] = value;
    }

    return { answers, unknown };
}

/**
 * Fills every prompt that still has no answer with its rendered default, in
 * graph order, so later defaults can see earlier answers. Blueprints whose
 * `when` does not hold are skipped entirely, matching what generation itself
 * would do with them.
 */
export function fillDefaults(
    spec: ProjectSpec,
    graph: BlueprintGraph,
    prompts: DeclaredPrompt[],
    deps: { atarashiVersion: string; now: Date }
): Record<string, JsonValue> {
    const answers: Record<string, JsonValue> = { ...spec.answers };

    for (const prompt of prompts) {
        if (answers[prompt.name] !== undefined) continue;

        const context = buildContext({ ...spec, answers }, graph, deps);
        if (!evaluateCondition(prompt.when, context)) continue;
        if (prompt.default === undefined) continue;

        answers[prompt.name] =
            typeof prompt.default === 'string'
                ? (renderString(prompt.default, context, prompt.name) as JsonValue)
                : prompt.default;
    }

    return answers;
}
