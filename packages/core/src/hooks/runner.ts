import { existsSync } from 'node:fs';
import { extname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { Worker } from 'node:worker_threads';
import { DIAGNOSTIC_CODES, type Diagnostic, error, info, warning } from '@atarashi/schema';
import type { RenderContext } from '../context.js';
import type { BlueprintGraph, GraphNode, LoadedBlueprint } from '../types.js';
import { guardSource, loaderSource, workerSource } from './sandbox.js';
import {
    DEFAULT_HOOK_TIMEOUT_MS,
    HOOK_MODULE_EXTENSIONS,
    type HookCapabilities,
    type HookName,
    type HookOutcome,
    type HookRunnerOptions,
    type HookSubject,
    MAX_HOOK_TIMEOUT_MS,
} from './types.js';

const CODE = 'ATA_HOOK_FAILED';
const SKIPPED = 'ATA_HOOK_SKIPPED';

const capabilitiesOf = (declared: readonly string[]): HookCapabilities => ({
    readFiles: declared.includes('read-files'),
    writeFiles: declared.includes('write-files'),
    readContext: declared.includes('read-context'),
});

/** Why a node's hook cannot run, or `undefined` when it can. */
interface Refusal {
    diagnostic: Diagnostic;
}

/**
 * Runs blueprint hooks in a restricted worker thread.
 *
 * A hook never touches the filesystem, the environment, the network or a
 * subprocess: it receives a structured clone of the thing it is allowed to see,
 * mutates it, and the runner copies back only what its declared capabilities
 * permit. Everything a hook returns is re-validated afterwards, because a hook
 * is exactly as trusted as the blueprint that shipped it (doc 09, T2).
 */
export class HookRunner {
    private readonly enabled: boolean;

    constructor(
        private readonly graph: BlueprintGraph,
        private readonly context: RenderContext,
        private readonly options: HookRunnerOptions = {}
    ) {
        this.enabled = options.enabled !== false;
    }

    /** Nodes declaring the named hook, in graph order. */
    nodesFor(hook: HookName): GraphNode[] {
        return this.graph.nodes.filter((node) =>
            node.blueprint.manifest.hooks?.exports.includes(hook)
        );
    }

    get declared(): boolean {
        return this.graph.nodes.some((node) => node.blueprint.manifest.hooks !== undefined);
    }

    /**
     * Threads `subject` through every blueprint declaring `hook`, in graph
     * order, so a later blueprint sees what an earlier one did.
     */
    async run<T extends HookSubject>(hook: HookName, subject: T): Promise<HookOutcome<T>> {
        const nodes = this.nodesFor(hook);
        if (nodes.length === 0) return { value: subject, diagnostics: [] };

        const diagnostics: Diagnostic[] = [];
        let current = subject;

        for (const node of nodes) {
            const refusal = await this.refuse(node, hook);
            if (refusal) {
                diagnostics.push(refusal.diagnostic);
                continue;
            }

            const result = await this.invoke(node, hook, current);
            diagnostics.push(...result.diagnostics);
            if (result.value) current = result.value as T;
        }

        return { value: current, diagnostics };
    }

    /** Trust, consent, `--no-hooks` and "is this module even loadable" checks. */
    private async refuse(node: GraphNode, hook: HookName): Promise<Refusal | undefined> {
        const blueprint = node.blueprint;
        const id = blueprint.manifest.id;
        const declaration = blueprint.manifest.hooks!;

        if (!this.enabled) {
            return {
                diagnostic: info(SKIPPED, `Skipped ${id}'s \`${hook}\` hook (--no-hooks)`, {
                    blueprints: [id],
                }),
            };
        }

        if (!blueprint.dir) {
            return {
                diagnostic: warning(
                    SKIPPED,
                    `${id} declares hooks but was not loaded from a directory, so they cannot run`,
                    { blueprints: [id] }
                ),
            };
        }

        const modulePath = this.moduleFor(blueprint);
        if (!modulePath) {
            return {
                diagnostic: error(
                    CODE,
                    `${id}'s hook module \`${declaration.module}\` is outside the blueprint`,
                    { blueprints: [id] }
                ),
            };
        }
        if (!HOOK_MODULE_EXTENSIONS.includes(extname(modulePath))) {
            return {
                diagnostic: error(
                    CODE,
                    `${id}'s hook module must be JavaScript, not \`${extname(modulePath)}\``,
                    {
                        blueprints: [id],
                        suggestions: ['Build the hook to `.js` before publishing the blueprint'],
                    }
                ),
            };
        }
        if (!existsSync(modulePath)) {
            return {
                diagnostic: error(
                    CODE,
                    `${id}'s hook module \`${declaration.module}\` is missing`,
                    {
                        blueprints: [id],
                    }
                ),
            };
        }

        if (blueprint.trusted) return undefined;

        // Untrusted blueprints need explicit, per-run consent. No consent
        // callback means no consent — the web builder never runs these.
        const granted = await this.options.consent?.({
            blueprint,
            capabilities: declaration.capabilities,
            hook,
        });
        if (granted === true) return undefined;

        return {
            diagnostic: warning(
                SKIPPED,
                `Skipped ${id}'s \`${hook}\` hook: it is not from a trusted source`,
                {
                    blueprints: [id],
                    detail: `capabilities: ${declaration.capabilities.join(', ') || 'none'}; source: ${blueprint.origin}`,
                    suggestions: [
                        'Re-run interactively to allow it, or pass `--no-hooks` to silence this',
                    ],
                }
            ),
        };
    }

    /** The hook module's absolute path, or `undefined` if it escapes the blueprint. */
    private moduleFor(blueprint: LoadedBlueprint): string | undefined {
        const root = resolve(blueprint.dir!);
        const target = resolve(root, blueprint.manifest.hooks!.module);
        const rel = relative(root, target);
        return rel === '' || rel.startsWith('..') || isAbsolute(rel) ? undefined : target;
    }

    private timeoutFor(node: GraphNode): number {
        const declared = node.blueprint.manifest.hooks?.timeoutMs ?? DEFAULT_HOOK_TIMEOUT_MS;
        const ceiling = Math.min(
            this.options.timeoutMs ?? MAX_HOOK_TIMEOUT_MS,
            MAX_HOOK_TIMEOUT_MS
        );
        return Math.max(1, Math.min(declared, ceiling));
    }

    /** One worker, one hook, one hard deadline. */
    private async invoke(
        node: GraphNode,
        hook: HookName,
        subject: HookSubject
    ): Promise<{ value?: HookSubject; diagnostics: Diagnostic[] }> {
        const blueprint = node.blueprint;
        const id = blueprint.manifest.id;
        const capabilities = capabilitiesOf(blueprint.manifest.hooks!.capabilities);
        const diagnostics: Diagnostic[] = [];

        const root = `${pathToFileURL(join(resolve(blueprint.dir!), '/')).href.replace(/\/?$/, '/')}`;
        const payload = this.narrow(subject, capabilities);

        let worker: Worker | undefined;
        try {
            const message = await new Promise<{ ok: boolean; subject?: unknown; error?: string }>(
                (resolveMessage, rejectMessage) => {
                    worker = new Worker(workerSource, {
                        eval: true,
                        // No inherited environment, arguments or Node flags.
                        env: {},
                        argv: [],
                        execArgv: [],
                        resourceLimits: { maxOldGenerationSizeMb: 128, stackSizeMb: 4 },
                        stdout: true,
                        stderr: true,
                        workerData: {
                            hook,
                            moduleUrl: pathToFileURL(this.moduleFor(blueprint)!).href,
                            blueprintRoot: root,
                            guardSource: guardSource(root),
                            loaderSource: loaderSource(root),
                            subject: payload,
                            context: capabilities.readContext ? this.contextView() : undefined,
                        },
                    });

                    const timer = setTimeout(() => {
                        rejectMessage(new Error(`timed out after ${this.timeoutFor(node)}ms`));
                    }, this.timeoutFor(node));
                    timer.unref?.();

                    worker.on('message', (value) => {
                        clearTimeout(timer);
                        resolveMessage(value);
                    });
                    worker.on('error', (thrown) => {
                        clearTimeout(timer);
                        rejectMessage(thrown);
                    });
                    worker.on('exit', (code) => {
                        clearTimeout(timer);
                        if (code !== 0) rejectMessage(new Error(`exited with code ${code}`));
                    });
                }
            );

            if (!message.ok) {
                return {
                    diagnostics: [
                        error(CODE, `${id}'s \`${hook}\` hook failed: ${message.error}`, {
                            blueprints: [id],
                            suggestions: ['Run with `--no-hooks` to generate without it'],
                        }),
                    ],
                };
            }

            const merged = this.merge(subject, message.subject, capabilities, id);
            diagnostics.push(...merged.diagnostics);
            return { value: merged.value, diagnostics };
        } catch (thrown) {
            const reason = thrown instanceof Error ? thrown.message : String(thrown);
            return {
                diagnostics: [
                    error(CODE, `${id}'s \`${hook}\` hook failed: ${reason}`, {
                        blueprints: [id],
                        suggestions: ['Run with `--no-hooks` to generate without it'],
                    }),
                ],
            };
        } finally {
            await worker?.terminate();
        }
    }

    private contextView() {
        const context = this.context;
        return {
            project: context.project,
            answers: context.answers,
            options: context.options,
            pm: context.pm,
            blueprints: context.blueprints,
            atarashi: context.atarashi,
            blueprintIds: this.graph.nodes.map((node) => node.blueprint.manifest.id),
            capabilities: [...this.graph.capabilities.keys()],
        };
    }

    /** Strips anything the hook has not earned the right to see. */
    private narrow(subject: HookSubject, capabilities: HookCapabilities): HookSubject {
        if (!('files' in subject)) return subject;
        return capabilities.readFiles ? subject : { ...subject, files: [] };
    }

    /**
     * Copies back only the fields the capabilities allow. A hook that changed
     * files without `write-files` gets a warning and no effect — silently
     * dropping the change would be worse than either failing or allowing it.
     */
    private merge(
        original: HookSubject,
        returned: unknown,
        capabilities: HookCapabilities,
        id: string
    ): { value: HookSubject; diagnostics: Diagnostic[] } {
        const diagnostics: Diagnostic[] = [];
        if (!returned || typeof returned !== 'object') return { value: original, diagnostics };

        const next = { ...original } as Record<string, unknown>;
        const from = returned as Record<string, unknown>;

        if ('answers' in original && from.answers && typeof from.answers === 'object') {
            next.answers = { ...(original as { answers: object }).answers, ...from.answers };
        }

        if ('warnings' in original && Array.isArray(from.warnings)) {
            next.warnings = from.warnings.filter(isDiagnostic);
        }

        if ('nextSteps' in original && Array.isArray(from.nextSteps)) {
            next.nextSteps = from.nextSteps.filter(
                (step): step is string => typeof step === 'string'
            );
        }

        if ('files' in original && Array.isArray(from.files)) {
            if (capabilities.writeFiles) {
                next.files = from.files;
            } else if (from.files.length !== (original as { files: unknown[] }).files.length) {
                diagnostics.push(
                    warning(
                        DIAGNOSTIC_CODES.SCHEMA_INVALID,
                        `${id}'s hook changed files without declaring the \`write-files\` capability`,
                        {
                            blueprints: [id],
                            suggestions: ['Add "write-files" to `hooks.capabilities`'],
                        }
                    )
                );
            }
        }

        return { value: next as unknown as HookSubject, diagnostics };
    }
}

const isDiagnostic = (value: unknown): value is Diagnostic =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Diagnostic).message === 'string' &&
    typeof (value as Diagnostic).code === 'string' &&
    ['error', 'warning', 'info'].includes((value as Diagnostic).severity);
