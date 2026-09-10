# @atarashi/schema

Zod schemas and inferred types for everything that crosses an Atarashi boundary:
the `ProjectSpec` a CLI or web builder produces, the blueprint and preset
manifests authors write, the registry index, and the `atarashi.json` recorded in
a generated project.

This package is the shared contract between the CLI and the web builder. It has
exactly one runtime dependency (`zod`) and no I/O.

```ts
import { parseBlueprintManifest, parseProjectSpec } from '@atarashi/schema';

const result = parseProjectSpec(JSON.parse(raw));
if (!result.ok) {
    for (const d of result.error.diagnostics) console.error(d.message);
}
```

## What you get

| Export | Purpose |
|---|---|
| `parseProjectSpec` / `parseProjectConfig` | Validate a spec or an `atarashi.json`, version-guarded first |
| `parseBlueprintManifest` / `parsePresetManifest` / `parseManifest` | Validate authored manifests |
| `parseRegistryIndex` / `parseUserConfig` | Validate registry and user configuration |
| `Result`, `AtarashiError`, `ok`, `fail` | The no-throw result type core returns |
| `Diagnostic`, `DIAGNOSTIC_CODES`, `Conflict` | Structured, machine-readable problems |
| `GenerationPlan`, `PlannedFile`, `PostAction` | The engine's output types |

Version guards run **before** schema validation, so a manifest from a newer
Atarashi produces "upgrade atarashi" rather than a wall of unknown-key errors.

## JSON Schema

`pnpm build` emits JSON Schema into `schemas/` for editor autocomplete in
`blueprint.json` and `atarashi.json`:

```json
{ "$schema": "https://unpkg.com/@atarashi/schema/schemas/blueprint.schema.json" }
```
