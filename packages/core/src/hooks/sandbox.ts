import { ALLOWED_BUILTINS } from './types.js';

/**
 * The loader that makes the worker a sandbox. It runs inside the worker and
 * decides what a hook module is allowed to import:
 *
 * - builtins: only the pure ones in `ALLOWED_BUILTINS`. No `fs`, no
 *   `child_process`, no `net`, no `worker_threads`, no `vm`.
 * - files: only paths inside the blueprint's own directory.
 *
 * Written as source text because it has to be handed to Node's module hooks —
 * either directly (`registerHooks`, Node 22.15+) or as a data: URL
 * (`register`, the Node 20 path).
 */
const GUARD_BODY = `
const ALLOWED = new Set(${JSON.stringify([...ALLOWED_BUILTINS])});

function guardedResolve(root, specifier, context, nextResolve) {
    const bare = specifier.replace(/^node:/, '');
    const isBuiltin =
        specifier.startsWith('node:') || !/^[./]|^[a-z][a-z0-9+.-]*:/i.test(specifier);

    if (isBuiltin && !ALLOWED.has(bare)) {
        throw new Error(
            'Blueprint hooks may not import \`' + specifier + '\`. Allowed builtins: ' +
                [...ALLOWED].join(', ')
        );
    }

    const resolved = nextResolve(specifier, context);
    if (resolved.url.startsWith('file:') && !resolved.url.startsWith(root)) {
        throw new Error(
            'Blueprint hooks may not import \`' + specifier + '\` from outside the blueprint'
        );
    }
    return resolved;
}
`;

/** The synchronous in-thread form, for `module.registerHooks`. An expression. */
export const guardSource = (root: string): string => `(() => {
${GUARD_BODY}
const root = ${JSON.stringify(root)};
return {
    resolve: (specifier, context, nextResolve) =>
        guardedResolve(root, specifier, context, nextResolve),
};
})()`;

/** The asynchronous loader-thread form, for `module.register` on Node 20. */
export const loaderSource = (root: string): string => `
${GUARD_BODY}
const root = ${JSON.stringify(root)};
export async function resolve(specifier, context, nextResolve) {
    return guardedResolve(root, specifier, context, nextResolve);
}
`;

/**
 * The worker's entry point, evaluated with `eval: true` so no separate build
 * artifact has to ship and be located at runtime.
 *
 * It receives the hook module URL, the blueprint root and the subject; it posts
 * back the subject the hook left behind. Nothing else crosses the boundary:
 * the hook cannot write files, spawn anything, or read the environment.
 */
export const workerSource = `
const { parentPort, workerData } = require('node:worker_threads');
const nodeModule = require('node:module');

(async () => {
    const send = (message) => parentPort.postMessage(message);

    try {
        if (typeof nodeModule.registerHooks === 'function') {
            // Node 22.15+: synchronous, in-thread, no loader thread at all.
            nodeModule.registerHooks(
                new Function('return ' + workerData.guardSource)()
            );
        } else {
            nodeModule.register(
                'data:text/javascript,' + encodeURIComponent(workerData.loaderSource),
                { parentURL: workerData.blueprintRoot }
            );
        }

        // Capabilities are an allowlist, so anything ambient that could reach
        // the network or the host goes before the hook module is even loaded.
        for (const name of ['fetch', 'XMLHttpRequest', 'WebSocket', 'EventSource', 'navigator']) {
            try {
                delete globalThis[name];
            } catch {}
        }

        const loaded = await import(workerData.moduleUrl);
        // A blueprint may export the hooks individually, under a \`hooks\`
        // object, or as the default export of \`defineHooks\`.
        const hook =
            loaded[workerData.hook] ??
            loaded.hooks?.[workerData.hook] ??
            loaded.default?.[workerData.hook];
        if (typeof hook !== 'function') {
            send({ ok: false, error: 'exports no \`' + workerData.hook + '\` function' });
            return;
        }

        const view = workerData.context
            ? {
                  ...workerData.context,
                  has: (id) => workerData.context.blueprintIds.includes(id),
                  provides: (capability) =>
                      workerData.context.capabilities.includes(capability),
              }
            : undefined;

        const subject = workerData.subject;
        const returned = await hook(subject, view);
        send({ ok: true, subject: returned ?? subject });
    } catch (thrown) {
        send({ ok: false, error: (thrown && thrown.message) || String(thrown) });
    }
})();
`;
