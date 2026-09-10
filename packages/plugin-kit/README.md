# @atarashi/plugin-kit

Everything you need to write, test and validate a third-party Atarashi
blueprint. This is the only Atarashi package a blueprint author depends on, and
it is a build- and test-time dependency: nothing in it is loaded by the projects
your blueprint generates.

```bash
pnpm add -D @atarashi/plugin-kit
```

```ts
// blueprint.ts
import { defineBlueprint, toManifestJson } from '@atarashi/plugin-kit';

export default defineBlueprint({
    id: 'acme/redis',
    version: '1.0.0',
    description: 'Redis client wired to the app lifecycle.',
    provides: ['cache', 'cache:redis'],
    conflicts: ['cache'],
    files: [{ from: 'templates/redis.ts.hbs', to: 'src/lib/redis.ts' }],
    dependencies: { ioredis: '^5.4.1' },
    env: [{ key: 'REDIS_URL', sample: 'redis://localhost:6379' }],
});
```

`defineBlueprint` validates as it returns, so an invalid manifest **throws at
build time** rather than failing for whoever installs your blueprint.
`toManifestJson` serialises the fully defaulted manifest to the `blueprint.json`
the registry reads.

## What you get

| Export | Purpose |
|---|---|
| `defineBlueprint` / `definePreset` | Validate and fully default an authored manifest. Throws on an invalid definition. |
| `toManifestJson` | Serialise a manifest to canonical `blueprint.json` text. |
| `defineHooks` | Type a hook module's `beforeRender` / `afterRender` / `afterPlan`. |
| `validateBlueprint` | Run the same conformance checks that gate a first-party release. |
| `Catalogue` | A `BlueprintSource` over a directory of blueprints, for tests. |
| `makeSpec` / `specForPreset` | Build a `ProjectSpec` the way the CLI would. |
| `planFor` / `expectPlan` | Generate a plan: `Result` for asserting on failures, throwing for the happy path. |
| `fileAt` / `hasFile` / `dependencyRange` | Assert on one generated file or one resolved dependency range. |
| `FIXED_NOW` / `FIXED_VERSION` | Frozen clock and version, so snapshots stay byte-identical. |

Manifest and plan types (`BlueprintManifest`, `GenerationPlan`, `ProjectSpec`,
`Contribution`, `FileEntry`, `Prompt` and the rest) are re-exported from
`@atarashi/schema`, so you never import it directly.

## Testing a blueprint

The harness generates a real plan in memory. Nothing touches disk, so a test is
as fast as a unit test and asserts on the actual composed output.

```ts
import { Catalogue, dependencyRange, expectPlan, fileAt, makeSpec } from '@atarashi/plugin-kit';

const catalogue = new Catalogue('./blueprints');

it('registers the client when composed with express', async () => {
    const spec = makeSpec(['core/node-ts', 'http/express', 'acme/redis']);
    const plan = await expectPlan(catalogue, spec);

    expect(fileAt(plan, 'src/lib/redis.ts')).toContain('new Redis(');
    expect(dependencyRange(plan, 'ioredis')).toBe('^5.4.1');
});
```

Use `planFor` instead of `expectPlan` when the failure *is* the assertion:

```ts
const result = await planFor(catalogue, makeSpec(['acme/redis', 'acme/memcached']));
expect(result.ok).toBe(false);
expect(result.error.diagnostics[0].code).toBe('CAPABILITY_CONFLICT');
```

## Validating before you publish

`validateBlueprint` is the implementation the first-party catalogue is gated on,
not a reduced copy of it. It checks the manifest, every `when` expression, every
template's Handlebars syntax, declared-versus-referenced prompts and env keys,
and the dependency allowlist.

```ts
import { validateBlueprint } from '@atarashi/plugin-kit';

const report = await validateBlueprint('./blueprints/acme/redis');
if (!report.ok) {
    for (const p of report.problems) console.error(`${p.severity}: ${p.check}: ${p.message}`);
}
```

A standalone blueprint cannot know what it will compose with, so references it
does not declare itself are warnings by default. Pass `knownPromptNames` and
`knownEnvKeys` when you are validating a whole collection and can be strict.

## Publishing

Point the `atarashi` field at the directory holding `blueprint.json`. The
directory name itself is free; the id comes from the manifest.

```json
{
    "name": "atarashi-blueprint-redis",
    "version": "1.0.0",
    "atarashi": "./blueprint",
    "files": ["blueprint"],
    "devDependencies": { "@atarashi/plugin-kit": "^1.0.0" }
}
```

The package name must match `atarashi-blueprint-<name>` (optionally scoped);
that pattern is what `--add npm:atarashi-blueprint-redis` resolves against.

Third-party blueprints are not second-class: they use the same format and the
same validator as the first-party ones. Their hooks are sandboxed and require
explicit consent, and they may only draw dependencies from the reviewed
allowlist. See
[Authoring blueprints](https://github.com/callmegautam/atarashi/blob/main/docs/guide/authoring-blueprints.md)
and the
[plugin API reference](https://github.com/callmegautam/atarashi/blob/main/docs/guide/plugin-api.md).
