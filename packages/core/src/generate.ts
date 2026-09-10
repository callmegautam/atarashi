import {
    DIAGNOSTIC_CODES,
    type Diagnostic,
    fail,
    type GenerationPlan,
    ok,
    type PlannedFile,
    type ProjectSpec,
    type Result,
} from '@atarashi/schema';
import { HookRunner } from './hooks/runner.js';
import type { AfterPlanSubject, AfterRenderSubject, HookFile } from './hooks/types.js';
import { merge } from './merge/merger.js';
import { assemblePlan } from './plan/assemble.js';
import { collect } from './plan/collect.js';
import { validatePlan } from './plan/validate.js';
import { buildContext } from './render/context.js';
import { render } from './render/renderer.js';
import { resolve } from './resolve/resolver.js';
import type { EngineDeps } from './types.js';
import { PathSafetyError } from './write/paths.js';
import { VirtualFileSystem } from './write/vfs.js';

const errorsIn = (diagnostics: Diagnostic[]) =>
    diagnostics.filter((diagnostic) => diagnostic.severity === 'error');

const toHookFiles = (files: PlannedFile[]): HookFile[] =>
    files.map((file) => ({
        path: file.path,
        contents: file.contents,
        mode: file.mode,
        sources: file.sources,
        binary: file.binary,
    }));

/**
 * Hook output re-enters the pipeline as untrusted input: every path goes back
 * through the same normalization the renderer's output did, so a hook cannot
 * write somewhere a template could not.
 */
function fromHookFiles(files: HookFile[]): VirtualFileSystem {
    const vfs = new VirtualFileSystem();
    for (const file of files) {
        const contents =
            typeof file.contents === 'string' ? file.contents : Buffer.from(file.contents);
        vfs.set(file.path, contents, {
            mode: file.mode,
            sources: file.sources,
            binary: Buffer.isBuffer(contents),
        });
    }
    return vfs;
}

/**
 * The whole engine: `ProjectSpec` in, `GenerationPlan` out. Pure — nothing here
 * touches disk, prints, or exits. Call `commit(plan, targetDir)` separately to
 * actually write.
 *
 * A plan with unresolved conflicts is returned as an *error*, not as a plan the
 * caller might accidentally write. The conflicts ride along in the diagnostics
 * so the CLI and the web builder can both explain them.
 */
export async function generate(
    spec: ProjectSpec,
    deps: EngineDeps
): Promise<Result<GenerationPlan>> {
    const now = (deps.now ?? (() => new Date()))();

    // 1. resolve
    const graph = await resolve(spec, deps);
    if (!graph.ok) return graph;

    const diagnostics: Diagnostic[] = [...graph.diagnostics];

    // 2. context
    let context = buildContext(spec, graph.value, {
        atarashiVersion: deps.atarashiVersion,
        now,
    });
    let runner = new HookRunner(graph.value, context, deps.hooks);
    let effectiveSpec = spec;

    // 2b. beforeRender — the one chance a blueprint has to derive an answer
    // from the rest of the graph before templates see it.
    if (runner.nodesFor('beforeRender').length > 0) {
        const before = await runner.run('beforeRender', { answers: { ...spec.answers } });
        diagnostics.push(...before.diagnostics);

        const failures = errorsIn(before.diagnostics);
        if (failures.length > 0) {
            return fail(failures[0]!.code, failures[0]!.message, diagnostics);
        }

        effectiveSpec = { ...spec, answers: before.value.answers };
        context = buildContext(effectiveSpec, graph.value, {
            atarashiVersion: deps.atarashiVersion,
            now,
        });
        runner = new HookRunner(graph.value, context, deps.hooks);
    }

    // 3. render + 4. collect declarative contributions
    const versions = (await deps.source.versionManifest?.()) ?? {};
    const rendered = await render(graph.value, context);
    const collected = collect(effectiveSpec, graph.value, context, versions);

    diagnostics.push(...rendered.diagnostics, ...collected.diagnostics);

    const renderFailures = errorsIn(rendered.diagnostics);
    if (renderFailures.length > 0) {
        return fail(
            DIAGNOSTIC_CODES.RENDER_FAILED,
            renderFailures.length === 1
                ? renderFailures[0]!.message
                : `${renderFailures.length} blueprints failed to render`,
            diagnostics
        );
    }

    // `collect` reports warnings for most things, but an untrusted blueprint
    // reaching for a package the registry does not pin is a security refusal.
    const collectFailures = errorsIn(collected.diagnostics);
    if (collectFailures.length > 0) {
        return fail(collectFailures[0]!.code, collectFailures[0]!.message, diagnostics);
    }

    // 5. merge
    const untrusted = new Set<string>(
        graph.value.nodes
            .filter((node) => !node.blueprint.trusted)
            .map((node) => node.blueprint.manifest.id)
    );
    const merged = merge(
        [...rendered.fragments, ...collected.fragments],
        rendered.slots,
        untrusted
    );
    diagnostics.push(...merged.diagnostics);

    // The merger reports warnings for most things, but a security refusal —
    // an untrusted blueprint reaching for an install script — is an error, and
    // nothing downstream would otherwise stop on it.
    const mergeFailures = errorsIn(merged.diagnostics);
    if (mergeFailures.length > 0) {
        return fail(mergeFailures[0]!.code, mergeFailures[0]!.message, diagnostics);
    }

    // 5b. afterRender — hooks see the merged tree, never the raw fragments.
    let files = merged.files;
    if (runner.nodesFor('afterRender').length > 0) {
        const subject: AfterRenderSubject = { files: toHookFiles(files.list()) };
        const after = await runner.run('afterRender', subject);
        diagnostics.push(...after.diagnostics);

        const failures = errorsIn(after.diagnostics);
        if (failures.length > 0) {
            return fail(failures[0]!.code, failures[0]!.message, diagnostics);
        }
        try {
            files = fromHookFiles(after.value.files);
        } catch (thrown) {
            if (!(thrown instanceof PathSafetyError)) throw thrown;
            return fail(DIAGNOSTIC_CODES.PATH_ESCAPE, thrown.message, diagnostics);
        }
    }

    // 6. plan
    let plan = assemblePlan({
        spec: effectiveSpec,
        graph: graph.value,
        context,
        files,
        collected,
        conflicts: merged.conflicts,
        warnings: diagnostics.filter((diagnostic) => diagnostic.severity !== 'error'),
    });

    // 6b. afterPlan — warnings, next steps and, with `write-files`, the output.
    if (runner.nodesFor('afterPlan').length > 0) {
        const subject: AfterPlanSubject = {
            files: toHookFiles(plan.files),
            warnings: plan.warnings,
            nextSteps: plan.summary.nextSteps,
            blueprints: plan.summary.blueprints,
        };
        const after = await runner.run('afterPlan', subject);
        diagnostics.push(...after.diagnostics);

        const failures = errorsIn(after.diagnostics);
        if (failures.length > 0) {
            return fail(failures[0]!.code, failures[0]!.message, diagnostics);
        }

        try {
            plan = {
                ...plan,
                files: fromHookFiles(after.value.files).list(),
                warnings: after.value.warnings,
                summary: {
                    ...plan.summary,
                    nextSteps: after.value.nextSteps,
                },
            };
        } catch (thrown) {
            if (!(thrown instanceof PathSafetyError)) throw thrown;
            return fail(DIAGNOSTIC_CODES.PATH_ESCAPE, thrown.message, diagnostics);
        }
        // The hook's own diagnostics are produced after the plan was
        // assembled, so they have to be folded back in explicitly.
        plan.warnings.push(
            ...after.diagnostics.filter((diagnostic) => diagnostic.severity !== 'error')
        );
        plan.summary.fileCount = plan.files.length;
        plan.summary.totalBytes = plan.files.reduce(
            (total, file) =>
                total +
                (Buffer.isBuffer(file.contents)
                    ? file.contents.byteLength
                    : Buffer.byteLength(file.contents, 'utf8')),
            0
        );
    }

    // 7. validate — after the hooks, so nothing they did escapes the gate
    const declaredEnv = new Set(collected.env.map((entry) => entry.key));
    const validation = validatePlan(plan, declaredEnv);
    const validationErrors = errorsIn(validation);
    plan.warnings.push(...validation.filter((diagnostic) => diagnostic.severity !== 'error'));

    if (plan.conflicts.length > 0) {
        return fail(
            DIAGNOSTIC_CODES.MERGE_CONFLICT,
            plan.conflicts.length === 1
                ? plan.conflicts[0]!.message
                : `${plan.conflicts.length} conflicts must be resolved before this project can be generated`,
            [
                ...plan.conflicts.map((conflict) => ({
                    severity: 'error' as const,
                    code: DIAGNOSTIC_CODES.MERGE_CONFLICT,
                    message: conflict.message,
                    blueprints: conflict.blueprints,
                    path: conflict.kind === 'file' ? conflict.subject : undefined,
                    suggestions: conflict.suggestions,
                })),
                ...diagnostics,
            ]
        );
    }

    if (validationErrors.length > 0) {
        return fail(validationErrors[0]!.code, validationErrors[0]!.message, [
            ...validationErrors,
            ...diagnostics,
        ]);
    }

    return ok(plan, diagnostics);
}
