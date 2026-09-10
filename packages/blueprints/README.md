# @atarashi/blueprints

The first-party blueprint collection: 36 blueprints and 6 presets, bundled with
the `atarashi` CLI so a generate with no network still works.

You do not normally install this yourself. The CLI depends on it, and the
registry's bundled loader reads the collection from beside this package's
`dist/`. Install it directly only when you are embedding the engine and want the
first-party catalogue as a `BlueprintSource`.

```ts
import { blueprintsDir, presetsDir, versionManifestPath } from '@atarashi/blueprints';

// Absolute paths inside this package, valid in both the source tree and the
// published tarball.
const root = blueprintsDir(); // .../blueprints
```

| Export | Returns |
|---|---|
| `collectionRoot()` | The package root holding the collection. |
| `blueprintsDir()` | The `blueprints/` tree, one directory per blueprint id. |
| `presetsDir()` | The `presets/` directory, one JSON manifest per preset. |
| `versionManifestPath()` | `version-manifest.json`, the id-to-version map for the bundled set. |

## What is in it

Blueprints are grouped by capability, and the directory path is the id
(`http/express`, `db/postgres`, `auth/jwt`):

`auth` · `ci` · `core` · `db` · `http` · `infra` · `lint` · `meta` · `mw` ·
`obs` · `orm` · `test` · `validation` · `web`

The presets are `backend-minimal`, `backend-ts`, `backend-mongo`,
`frontend-only`, `fullstack-react` and `fullstack-angular`.

Every blueprint is a directory with a `blueprint.json` and template files, in
exactly the format a third-party blueprint uses. Nothing here is privileged:
these manifests are validated by the same `validateBlueprint` that community
authors run, and each one carries a generated `README.md` rendered into the
[blueprint catalogue](https://github.com/callmegautam/atarashi/blob/main/docs/guide/blueprints.md).

## Adding one

Blueprints are the most parallelizable work in the project and need no engine
knowledge. See
[Authoring blueprints](https://github.com/callmegautam/atarashi/blob/main/docs/guide/authoring-blueprints.md);
`pnpm validate:blueprints` is the gate a change has to pass.
