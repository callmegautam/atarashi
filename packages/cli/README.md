# atarashi

Composable project scaffolding. Describe capabilities; get a project that runs.

Atarashi builds a project out of small composable units called blueprints. You
pick capabilities (an HTTP framework, a database, an ORM, auth, testing) and it
resolves them, renders them, and merges them into one coherent project. It
refuses combinations that cannot work, fills in what you forgot, and records
what you chose so you can add to it later.

```bash
npx atarashi@latest new my-api --preset backend-ts --yes
cd my-api && pnpm dev
```

No install needed; `npx atarashi@latest` works forever. Node 20.11+.

## Pick what goes in

**A preset**, a set known to work together:

```bash
atarashi new my-api --preset backend-ts
```

**Shorthands**, the common axes, without learning ids:

```bash
atarashi new my-api --http fastify --db postgres --orm drizzle --auth jwt
```

**Blueprints**, the real thing underneath. 36 of them:

```bash
atarashi new my-api --add http/express --add db/mongodb --add orm/mongoose
```

Run `atarashi` with no arguments for the interactive wizard, or
`atarashi list` to browse what is available.

## Commands

```text
atarashi                                  Interactive wizard
atarashi new <name> [options]             Create a project
atarashi add <blueprint...> [options]     Add capabilities to an existing project
atarashi list [blueprints|presets]        Browse what's available
atarashi info <blueprint>                 Details for one blueprint
atarashi preset <save|list|delete>        Save/list/delete personal presets
atarashi config <get|set|unset|list|path> User-level settings
atarashi registry <subcommand>            update|list|pin|unpin|verify|clear|add|sources
atarashi doctor [--fix]                   Diagnose environment + a project
atarashi create-blueprint <id>            Scaffold + validate a new blueprint
atarashi eject                            Inline blueprints into the project
atarashi upgrade                          Check for a newer atarashi
atarashi completion <bash|zsh|fish>       Shell completions
```

Every command that changes something accepts `--dry-run`, which prints the full
plan (every file, every dependency, every conflict) and writes nothing.

## Add to a project later

Generation records the spec in `atarashi.json`, so the project stays extendable:

```bash
cd my-api
atarashi add auth/jwt
```

Atarashi renders what the new blueprint contributes and splices it into the slot
regions in your source. Files you have edited by hand since generation are never
overwritten silently; you get a diff and a choice.

## What you can rely on

- **A generated project installs, builds, lints and boots with zero manual
  edits.** That is the release gate, checked across an end-to-end matrix.
- **Determinism.** Regenerating from a committed `atarashi.json` reproduces the
  project byte for byte. The one exception is a minted secret in `.env`, which
  is gitignored and per-machine by design.
- **No runtime dependency.** Nothing Atarashi generates depends on Atarashi.
  Delete `atarashi.json` and you have an ordinary project.
- **Offline works.** The first-party blueprints are bundled, so `--offline`
  resolves with no network at all.
- **Third-party blueprints are not second-class.** They use the same format and
  the same validator as the first-party ones, their hooks are sandboxed in a
  worker with capability gating and a timeout, and they require explicit consent.

## Documentation

- [Getting started](https://github.com/callmegautam/atarashi/blob/main/docs/guide/getting-started.md)
- [CLI reference](https://github.com/callmegautam/atarashi/blob/main/docs/guide/cli.md)
- [Blueprint catalogue](https://github.com/callmegautam/atarashi/blob/main/docs/guide/blueprints.md)
- [Presets](https://github.com/callmegautam/atarashi/blob/main/docs/guide/presets/)
- [Configuration](https://github.com/callmegautam/atarashi/blob/main/docs/guide/configuration.md)
- [Recipes](https://github.com/callmegautam/atarashi/blob/main/docs/guide/recipes.md)
- [Troubleshooting](https://github.com/callmegautam/atarashi/blob/main/docs/guide/troubleshooting.md)
- [Authoring blueprints](https://github.com/callmegautam/atarashi/blob/main/docs/guide/authoring-blueprints.md)

MIT © Gautam Suthar
