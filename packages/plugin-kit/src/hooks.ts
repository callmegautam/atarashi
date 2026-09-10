import type {
    AfterPlanSubject,
    AfterRenderSubject,
    BeforeRenderSubject,
    HookContextView,
    HookFile,
    HookName,
} from '@atarashi/core';

export type {
    AfterPlanSubject,
    AfterRenderSubject,
    BeforeRenderSubject,
    HookContextView,
    HookFile,
    HookName,
};

/**
 * A hook mutates the subject in place, or returns a replacement. `context` is
 * present only when the manifest declares the `read-context` capability, so it
 * is optional here — the sandbox passes `undefined` when it was not granted.
 */
export type Hook<Subject> = (
    subject: Subject,
    context?: HookContextView
) =>
    | Subject
    | void
    // biome-ignore lint/suspicious/noConfusingVoidType: `undefined` here would reject the common hook that mutates the subject and returns nothing.
    | Promise<Subject | void>;

export interface BlueprintHooks {
    /** Runs before templates render. The place to derive or override answers. */
    beforeRender?: Hook<BeforeRenderSubject>;
    /** Runs on rendered files, before merges are assembled into a plan. */
    afterRender?: Hook<AfterRenderSubject>;
    /** Runs on the assembled plan. The place to add warnings and next steps. */
    afterPlan?: Hook<AfterPlanSubject>;
}

/**
 * Types a blueprint's hook module. The sandbox accepts the hooks as individual
 * named exports, under a `hooks` export, or as this function's return value
 * used as the default export.
 */
export const defineHooks = (hooks: BlueprintHooks): BlueprintHooks => hooks;
