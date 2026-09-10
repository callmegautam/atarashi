# `@atarashi/registry`

The only I/O boundary for blueprints. `@atarashi/core` asks this package for a
`LoadedBlueprint` and never touches the disk or the network itself.

```ts
import { createRegistry } from '@atarashi/registry';
import { generate } from '@atarashi/core';

const registry = createRegistry({ cwd: process.cwd(), offline: false });
const plan = await generate(spec, { source: registry, atarashiVersion });
```

## Four layers

| Layer | Where | Trust |
|---|---|---|
| Local | `./.atarashi/blueprints/<ns>/<name>/blueprint.json` | Untrusted |
| npm | `atarashi-blueprint-*` packages, by `npm:` spec | Untrusted |
| Registry | `registry.atarashi.dev`, verified and cached | Per source |
| Bundled | `@atarashi/blueprints`, inside the npm package | Trusted |

Local wins outright, so an author can override anything while developing. Then
npm. Then the registry and the bundled collection compete on version: the newer
one wins, which is how a registry release ships a blueprint fix without a CLI
release, while a run with no network still resolves everything from the
bundled copy.

`trusted` is set by the *source*, never by the document the source serves. Only
trusted blueprints may run hooks without explicit consent (doc 09, T2).

## Integrity

- The index carries a root hash over its canonicalized entries and version
  manifest; it is re-verified on every read, including from the cache.
- Every tarball is checked against its `sha256` digest before extraction.
- A mismatch is a hard failure that names the artifact. There is no fallback
  path to an unverified copy: unreachability degrades, tampering does not.

## Extraction

Archives are parsed entirely in memory and only written once every member has
been validated: no absolute paths, drive letters, UNC paths, `..` segments,
null bytes, symlinks or hard links; per-file, total-size and entry-count
ceilings; case-collision detection; and a re-check that each resolved path is
inside the destination. This is a security boundary; see `tests/extract.test.ts`.

## Cache

```
$XDG_CACHE_HOME/atarashi/        # ~/Library/Caches on macOS, LOCALAPPDATA on Windows
  index/1.4.2.json               # verified against its published root hash
  blueprints/db-postgres-1.2.0-8f2c…/
  meta.json                      # ETags, fetch timestamps
```

Content-addressed, so it is safe to share between projects and CI runs
(`~/.cache/atarashi` makes a good CI cache key). Override with
`ATARASHI_CACHE_DIR`.

Freshness is a 24 h TTL plus an ETag: inside the TTL nothing is requested, and
after it a `304` costs one conditional GET. A pinned version skips both: a
published registry version is immutable, so a cache hit is always correct.

## Offline

`offline: true` or `ATARASHI_OFFLINE=1` skips the network entirely. Bundled
blueprints and anything already cached still resolve; a registry-only blueprint
reports what to run to populate the cache.

## Publishing

```bash
pnpm --filter @atarashi/registry build:index      # pack, hash, emit v1/index.json
pnpm --filter @atarashi/registry bump:versions    # propose version-manifest bumps
```

`build-index.mts` is deterministic (sorted members, fixed mtime, no uid/gid),
so rebuilding the same sources produces byte-identical tarballs and the same
digests. `.github/workflows/registry-publish.yml` publishes it and refuses to
overwrite a version that already exists.
