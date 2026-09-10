// The manifest and plan types an author writes against, so a blueprint package
// needs `@atarashi/plugin-kit` as its only Atarashi dependency.
export type {
    BlueprintManifest,
    Contribution,
    DependencySpec,
    EnvEntry,
    FileEntry,
    GenerationPlan,
    MergeStrategy,
    PlannedFile,
    PresetManifest,
    ProjectSpec,
    Prompt,
    PromptType,
} from '@atarashi/schema';
export {
    type BlueprintDefinition,
    defineBlueprint,
    definePreset,
    type PresetDefinition,
    toManifestJson,
} from './define.js';
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
} from './harness.js';
export {
    type AfterPlanSubject,
    type AfterRenderSubject,
    type BeforeRenderSubject,
    type BlueprintHooks,
    defineHooks,
    type Hook,
    type HookContextView,
    type HookFile,
    type HookName,
} from './hooks.js';
export {
    type ConformanceProblem,
    type ConformanceReport,
    type ConformanceSeverity,
    type ValidateOptions,
    validateBlueprint,
} from './validate.js';
