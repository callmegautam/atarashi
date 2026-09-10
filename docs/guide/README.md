# Atarashi documentation

The user-facing guide to Atarashi: how to use the CLI, what the blueprints do,
and how to author your own.

## Start here

- **[Getting started](./getting-started.md)**: the 30-second version, then the
  ideas underneath it.
- **[Migrating from v0.6](../../MIGRATION.md)**: what each old template name
  maps to, and what changed underneath.

## Reference

- **[CLI reference](./cli.md)**: every command and flag, printed by the binary.
- **[Blueprint catalogue](./blueprints.md)**: all 36 first-party blueprints.
- **[Presets](./presets/)**: what each one produces, with the full file tree.
- **[Configuration](./configuration.md)**: settings, precedence, environment
  variables.

## Guides

- **[Recipes](./recipes.md)**: add auth to an existing project, use it in CI,
  fork a blueprint, standardise a team's stack.
- **[Troubleshooting and FAQ](./troubleshooting.md)**: what an error means and
  what to do about it.

## Extending it

- **[Authoring blueprints](./authoring-blueprints.md)**: from `create-blueprint`
  to a published package.
- **[Plugin API reference](./plugin-api.md)**: `@atarashi/plugin-kit` in detail.

## Generated pages

`cli.md`, `blueprints.md`, `presets/` and every blueprint's own README are
generated from the thing they describe (the binary's help output, the manifests,
and real generation plans), so they cannot drift:

```bash
pnpm build:docs      # regenerate
pnpm check:docs      # fail if they are out of date
```
