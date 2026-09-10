# Contributing to Atarashi

Thanks for helping. This repo is a pnpm + Turborepo monorepo on Node 20.11+.

```bash
pnpm install
pnpm build
pnpm typecheck && pnpm lint && pnpm test
```

## Layout

| Path | What lives there |
|---|---|
| `packages/schema` | Zod schemas and types: the contract shared with the web builder |
| `packages/core` | The generation engine (resolve → render → merge → plan → write) |
| `packages/registry` | Blueprint fetching, integrity verification, caching |
| `packages/blueprints` | First-party blueprint content |
| `packages/cli` | The published `atarashi` binary |
| `packages/plugin-kit` | Types and helpers for third-party blueprint authors |
| `packages/testing` | Internal test harness (private) |
| `docs/guide` | User-facing documentation |

## The rules that keep the layering honest

- `@atarashi/core` never calls `process.exit`, never writes to stdout, and never
  prompts. It returns results and diagnostics; the CLI decides what to print.
- Nothing touches disk before `Writer.commit(plan)`. If you need a new
  side effect, it belongs in a post-action, not in the pipeline.
- Generation is deterministic: identical inputs must produce byte-identical
  output. Sort anything you iterate.

## Working on a blueprint

Blueprints are data (`blueprint.json` + a `files/` tree). Prefer adding a
capability to an existing blueprint over forking a new one, and never commit a
lockfile inside blueprint content.

## Commits and releases

Conventional Commits (`feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`).
Feature work goes on `feat/*` and is squash-merged. If your change affects a
published package, run `pnpm changeset` and commit the generated file.

Releasing is manual and maintainer-only: `pnpm release:check` runs every gate in
one command, then `pnpm version-packages` writes the versions and changelogs and
`pnpm release` publishes. CI never publishes.

## Before you open a PR

- Tests for the behaviour you changed
- `pnpm build && pnpm typecheck && pnpm lint && pnpm test` green
- Docs under `docs/` updated when behaviour changes. The generated pages are
  built from the code, so run `pnpm build:docs` rather than editing them
- CI runs the same gates on Linux, the unit suites on macOS and Windows across
  Node 20.11, 22 and 24, and the full e2e matrix
