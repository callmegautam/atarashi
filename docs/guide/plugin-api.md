# Plugin API reference

`@atarashi/plugin-kit` is the only Atarashi package a blueprint author needs. It
carries the types you write against, a manifest builder, the hook types, the
conformance suite, and a test harness.

```bash
npm install --save-dev @atarashi/plugin-kit
```

Everything here is ESM and typed. Nothing in it is loaded by a generated project
at runtime; it is a build- and test-time dependency of the blueprint, not of the
project the blueprint produces.

## Defining a manifest in TypeScript

`blueprint.json` is the shipped artefact, but you can author it in TypeScript and
emit the JSON, which gets you completion and a validation error at build time
rather than a diagnostic at generation time.

```ts
import { defineBlueprint, toManifestJson } from '@atarashi/plugin-kit';

export const redis = defineBlueprint({
    id: 'acme/redis',
    name: 'Redis',
    version: '1.0.0',
    description: 'A shared Redis client with connection handling.',
    category: 'cache',
    provides: ['cache', 'cache:redis'],
    requires: ['runtime:node', 'config:env'],
    conflicts: ['cache'],
    files: [{ from: 'files/client.ts.hbs', to: 'src/lib/redis.ts' }],
    dependencies: { ioredis: '^5.4.1' },
});

writeFileSync('blueprint.json', toManifestJson(redis));
```

| Export | Signature | Notes |
|---|---|---|
| `defineBlueprint` | `(definition) => BlueprintManifest` | Validates and returns the fully defaulted manifest. **Throws** on an invalid definition: an author's bug at build time, not a runtime condition. Fills in `manifestVersion` and `kind`. |
| `definePreset` | `(definition) => PresetManifest` | The same for a preset. |
| `toManifestJson` | `(manifest) => string` | Stable, formatted JSON, ready to write. |

## Types

Re-exported from `@atarashi/schema`, so a blueprint package never depends on it
directly:

`BlueprintManifest`, `PresetManifest`, `ProjectSpec`, `GenerationPlan`,
`PlannedFile`, `FileEntry`, `Contribution`, `DependencySpec`, `EnvEntry`,
`MergeStrategy`, `Prompt`, `PromptType`.

## Hooks

```ts
import { defineHooks } from '@atarashi/plugin-kit';

export default defineHooks({
    beforeRender(subject, context) { … },
    afterRender(subject, context) { … },
    afterPlan(subject, context) { … },
});
```

A hook either mutates the subject in place and returns nothing, or returns a
replacement. Both are accepted; mutation is the common case.

| Hook | Subject | When it runs | Use it to |
|---|---|---|---|
| `beforeRender` | `BeforeRenderSubject` | After answers are collected, before any template renders | Derive or default an answer |
| `afterRender` | `AfterRenderSubject` | On rendered files, before merges are assembled | Rewrite generated content |
| `afterPlan` | `AfterPlanSubject` | On the assembled plan | Add warnings and next steps |

`context` is a `HookContextView`: the render context, read-only. It is passed
only when the manifest declares the `read-context` capability; otherwise it is
`undefined`.

The sandbox accepts the hooks as individual named exports, under a `hooks`
export, or as the default export.

### Capabilities and limits

| Capability | Grants |
|---|---|
| `read-context` | The `context` argument |
| `read-files` | Reading files in the plan |
| `write-files` | Adding to or modifying files in the plan |

Anything not declared is denied. Hooks run in a worker thread with no network,
and are killed past `timeoutMs` (default 5 s, maximum 30 s). Hooks from an
untrusted source (anything loaded from npm or a third-party registry) require
explicit consent before they run, and `--no-hooks` disables them entirely.

## Validating

```ts
import { validateBlueprint } from '@atarashi/plugin-kit';

const report = await validateBlueprint('./acme/redis', {
    knownPromptNames: ['db.name'],
    knownEnvKeys: ['DATABASE_URL'],
    versionManifest,
});

if (!report.ok) {
    for (const problem of report.problems) {
        console.error(`${problem.severity}: [${problem.check}] ${problem.message}`);
    }
}
```

`ConformanceReport` is `{ id, dir, ok, problems }`, where each problem is
`{ check, severity, message, path? }`. `ok` is false when any problem is an
error; warnings do not fail it.

The options exist because a blueprint validated on its own cannot know what it
will compose with. Pass what its siblings declare and references to their prompts
and env keys stop being reported. Omit them and those become warnings rather than
errors. `versionManifest` is only needed if your dependencies take their ranges
from the registry rather than pinning their own.

`atarashi create-blueprint <id> --validate <dir>` is this function behind a CLI.

## Testing

The harness generates a real plan from real blueprints, in memory, with no
network and no writes.

```ts
import { Catalogue, expectPlan, fileAt, hasFile, makeSpec } from '@atarashi/plugin-kit';

const catalogue = new Catalogue('./');

it('writes a client that reads REDIS_URL', async () => {
    const plan = await expectPlan(catalogue, makeSpec(['core/node-ts', 'acme/redis']));
    expect(hasFile(plan, 'src/lib/redis.ts')).toBe(true);
    expect(fileAt(plan, 'src/lib/redis.ts')).toContain('env.REDIS_URL');
});
```

| Export | What it does |
|---|---|
| `Catalogue` | A `BlueprintSource` over a directory of blueprints, exactly as the bundled catalogue is loaded |
| `makeSpec` | A `ProjectSpec` from a list of ids, with sane defaults |
| `specForPreset` | A `ProjectSpec` from a preset, as `--preset` would build it |
| `planFor` | `Promise<Result<GenerationPlan>>`, for asserting on failures |
| `expectPlan` | The plan, throwing with the diagnostics attached, for the happy path |
| `fileAt` / `hasFile` | Read one generated file's contents / check it exists |
| `dependencyRange` | The resolved range for one dependency in a plan |
| `FIXED_VERSION` / `FIXED_NOW` | Pinned so snapshots are byte-identical across runs |

Because the version and timestamp are pinned, a snapshot test over the whole plan
is stable, which is how the first-party catalogue is tested.

```ts
it('produces the same output every time', async () => {
    const plan = await expectPlan(catalogue, makeSpec(['core/node-ts', 'acme/redis']));
    expect(plan.files.map((f) => [f.path, f.contents])).toMatchSnapshot();
});
```

## Package layout for publishing

```json
{
  "name": "atarashi-blueprint-acme-redis",
  "version": "1.0.0",
  "atarashi": "./blueprint",
  "files": ["blueprint"],
  "devDependencies": { "@atarashi/plugin-kit": "^1.0.0" }
}
```

The `atarashi` field must point inside the package at the directory holding
`blueprint.json`. The directory name itself is free; the id comes from the
manifest.

See [Authoring blueprints](./authoring-blueprints.md) for the full walkthrough
and the trust model.
