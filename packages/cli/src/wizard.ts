import {
    type BlueprintGraph,
    type BlueprintSummary,
    buildContext,
    evaluateCondition,
    renderString,
} from '@atarashi/core';
import type {
    GenerationPlan,
    JsonValue,
    PackageManager,
    PresetManifest,
    ProjectSpec,
} from '@atarashi/schema';
import { projectNameSchema } from '@atarashi/schema';
import * as clack from '@clack/prompts';
import type { DeclaredPrompt } from './prompts.js';
import { validateAnswer } from './prompts.js';

export class WizardCancelled extends Error {
    constructor() {
        super('Cancelled.');
        this.name = 'WizardCancelled';
    }
}

function ensure<T>(value: T | symbol): T {
    if (clack.isCancel(value)) throw new WizardCancelled();
    return value;
}

export async function askProjectName(defaultName: string): Promise<string> {
    const value = await clack.text({
        message: 'Project name',
        initialValue: defaultName,
        validate: (input) => {
            const parsed = projectNameSchema.safeParse(input);
            return parsed.success ? undefined : parsed.error.issues[0]?.message;
        },
    });
    return ensure(value);
}

export interface StartChoice {
    preset?: PresetManifest;
    custom: boolean;
}

export async function pickStart(presets: PresetManifest[]): Promise<StartChoice> {
    const options = [
        ...presets
            .filter((preset) => !preset.deprecated)
            .sort((a, b) => Number(b.recommended) - Number(a.recommended))
            .map((preset) => ({
                value: preset.id,
                label: preset.name + (preset.recommended ? ' (recommended)' : ''),
                hint: preset.description,
            })),
        { value: '__custom__', label: 'Custom — pick blueprints' },
    ];

    const choice = ensure(await clack.select({ message: 'Start from', options })) as string;

    if (choice === '__custom__') return { custom: true };
    return { preset: presets.find((preset) => preset.id === choice), custom: false };
}

export async function pickBlueprints(
    message: string,
    summaries: BlueprintSummary[],
    preselected: string[] = []
): Promise<string[]> {
    if (summaries.length === 0) return [];
    const selected = ensure(
        await clack.multiselect({
            message,
            options: summaries.map((summary) => ({
                value: summary.id,
                label: summary.id,
            })),
            initialValues: preselected,
            required: false,
        })
    ) as string[];
    return selected;
}

export async function askPrompts(
    prompts: DeclaredPrompt[],
    spec: ProjectSpec,
    graph: BlueprintGraph,
    deps: { atarashiVersion: string; now: Date }
): Promise<Record<string, JsonValue>> {
    const answers: Record<string, JsonValue> = { ...spec.answers };

    for (const prompt of prompts) {
        if (answers[prompt.name] !== undefined) continue;

        const context = buildContext({ ...spec, answers }, graph, deps);
        if (!evaluateCondition(prompt.when, context)) continue;

        const rendered =
            typeof prompt.default === 'string'
                ? renderString(prompt.default, context, prompt.name)
                : prompt.default;

        let value: JsonValue;
        switch (prompt.type) {
            case 'confirm':
                value = ensure(
                    await clack.confirm({
                        message: prompt.message,
                        initialValue: Boolean(rendered),
                    })
                ) as boolean;
                break;
            case 'number':
                value = Number(
                    ensure(
                        await clack.text({
                            message: prompt.message,
                            initialValue: rendered !== undefined ? String(rendered) : undefined,
                            validate: (input) =>
                                Number.isNaN(Number(input)) ? 'Must be a number' : undefined,
                        })
                    )
                );
                break;
            case 'select':
                value = ensure(
                    await clack.select({
                        message: prompt.message,
                        initialValue: rendered as string | number | boolean | undefined,
                        options: (prompt.choices ?? [])
                            .filter((choice) => evaluateCondition(choice.when, context))
                            .map((choice) => ({
                                value: choice.value,
                                label: choice.label,
                                hint: choice.hint,
                            })),
                    })
                ) as JsonValue;
                break;
            case 'multiselect':
                value = ensure(
                    await clack.multiselect({
                        message: prompt.message,
                        initialValues: Array.isArray(rendered) ? rendered : [],
                        required: false,
                        options: (prompt.choices ?? [])
                            .filter((choice) => evaluateCondition(choice.when, context))
                            .map((choice) => ({
                                value: choice.value,
                                label: choice.label,
                                hint: choice.hint,
                            })),
                    })
                ) as JsonValue;
                break;
            default:
                value = ensure(
                    await clack.text({
                        message: prompt.message,
                        initialValue: rendered !== undefined ? String(rendered) : undefined,
                        validate: (input) => {
                            try {
                                validateAnswer(prompt, input);
                                return undefined;
                            } catch (thrown) {
                                return (thrown as Error).message;
                            }
                        },
                    })
                ) as string;
        }

        answers[prompt.name] = value;
    }

    return answers;
}

export async function askPackageManager(detected: PackageManager): Promise<PackageManager> {
    const value = ensure(
        await clack.select({
            message: 'Package manager',
            initialValue: detected,
            options: (['pnpm', 'npm', 'yarn', 'bun'] as const).map((name) => ({
                value: name,
                label: name,
            })),
        })
    ) as PackageManager;
    return value;
}

export async function askInstall(defaultValue: boolean): Promise<boolean> {
    return ensure(
        await clack.confirm({ message: 'Install dependencies now?', initialValue: defaultValue })
    ) as boolean;
}

export function summarizePlan(plan: GenerationPlan): string {
    const lines = [
        `${plan.summary.fileCount} files`,
        `${plan.summary.deps.dependencies.length} dependencies, ${plan.summary.deps.devDependencies.length} dev dependencies`,
        `blueprints: ${plan.summary.blueprints.map((blueprint) => blueprint.id).join(' ')}`,
    ];
    return lines.map((line) => `  ${line}`).join('\n');
}

export async function confirmCreate(plan: GenerationPlan): Promise<boolean> {
    clack.note(summarizePlan(plan), 'Plan');
    return ensure(await clack.confirm({ message: 'Create it?', initialValue: true })) as boolean;
}

export { clack };
