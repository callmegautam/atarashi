# @atarashi/core

The Atarashi generation engine. Takes a `ProjectSpec`, returns a
`GenerationPlan`. Pure: it never calls `process.exit`, never writes to stdout,
never prompts, and never touches disk until you explicitly commit a plan.

```ts
import { generate, commit, runActions } from '@atarashi/core';

const plan = await generate(spec, { source: registry, atarashiVersion: '1.0.0' });
if (!plan.ok) {
    for (const d of plan.error.diagnostics) console.error(d.message);
    process.exit(1);
}

// Everything above is side-effect free; this is where the disk is touched.
const written = commit(plan.value, '/path/to/my-api');
await runActions(plan.value, spec, { targetDir: '/path/to/my-api' });
```

## The pipeline

| Stage | What it does |
|---|---|
| `resolve` | Selected ids → an ordered, validated blueprint graph. Expands `requires`, auto-adds unambiguous providers, detects conflicts and cycles, checks `engines`. |
| `buildContext` | One frozen object read by every template and every `when` expression. |
| `render` | Per-file `when`, path templating, Handlebars with a curated helper set → `FileFragment[]`. |
| `collect` | Dependencies, scripts, env vars, gitignore lines and next steps → more fragments, so declarative content and templated content share one merge path. |
| `merge` | Groups fragments by path and reduces them with the declared strategy; injects slot contributions. |
| `assemblePlan` | Files + post-actions + warnings + dependency summary + `atarashi.json`. |
| `HookRunner` | Runs `beforeRender`, `afterRender` and `afterPlan` in a sandboxed worker between the stages they are named for. |
| `validatePlan` | Size caps, case collisions, path escapes, JSON/YAML syntax, undeclared env keys. |
| `commit` | Stage to a temp dir, fsync, atomic rename, full rollback on any failure. |

## Invariants worth preserving

- **The plan is a virtual filesystem.** `--dry-run`, the web preview, the zip
  download and snapshot tests all fall out of this for free. If you add a stage,
  it operates on the VFS, not on disk.
- **Determinism.** Identical inputs produce byte-identical output. Everything
  iterated is sorted; graph order is total (`after` → `priority` → id).
- **No silent overwrites.** Two blueprints writing one path is a conflict unless
  a strategy says otherwise.
- **Every path is checked twice**: once when it enters the VFS, once against
  the resolved target directory before the writer moves anything.
- **Hook output is untrusted input.** Anything a hook returns re-enters through
  the same normalization and the same `validatePlan` gate as rendered output.

## Hooks

A blueprint may declare `hooks: { module, exports, capabilities, timeoutMs }`.
Each hook runs in its own `node:worker_thread` with:

- an **empty environment** (`env: {}`), no `argv`, no `execArgv`, and no
  `fetch`, `WebSocket` or `XMLHttpRequest`;
- a **module loader** that allows only pure builtins (`path`, `url`, `util`,
  `buffer`, `assert`, `events`, `querystring`, `string_decoder`) and refuses any
  import resolving outside the blueprint's own directory;
- a **hard timeout** (the manifest's `timeoutMs`, capped at 30 s) after which
  the worker is terminated;
- only what its capabilities allow: `read-files` to see the file list,
  `write-files` for its changes to be kept, `read-context` to receive the render
  context.

A hook never touches the filesystem. It mutates a structured clone of its
subject and the runner copies back the permitted fields. Blueprints from
untrusted sources need explicit consent (`hooks.consent`), and `--no-hooks`
(`hooks.enabled: false`) skips every hook with a warning rather than failing.

## The `when` expression language

A small non-Turing-complete language, parsed to an AST and interpreted, never
`eval`'d. Bindings: `answers.*`, `project.*`, `options.*`, `pm.*`, `has(id)`,
`provides(capability)`. Operators: `&& || ! === !== < <= > >= + -` and `in`.
No member calls, no loops, no property access on call results.
