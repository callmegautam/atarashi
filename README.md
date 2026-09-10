# Atarashi

[![npm version](https://img.shields.io/npm/v/atarashi)](https://www.npmjs.com/package/atarashi)
[![npm downloads](https://img.shields.io/npm/dm/atarashi)](https://www.npmjs.com/package/atarashi)
[![license](https://img.shields.io/npm/l/atarashi)](./LICENSE)

**Scaffold a project by choosing what it should do, not which template folder to
copy.**

Atarashi builds a project out of small composable units called blueprints. You
pick capabilities (an HTTP framework, a database, an ORM, auth, testing) and it
resolves them, renders them, and merges them into one coherent project. It
refuses combinations that cannot work, fills in what you forgot, and writes
nothing until the whole plan is valid.

```bash
npx atarashi@latest new my-api --preset backend-ts --yes
cd my-api && pnpm dev
```

That project installs, builds, lints, tests, boots, and answers `GET /health`
with no edits from you. That is the bar every generated project has to clear.

![Atarashi composing a project, then adding a capability to it](./demo/atarashi.gif)

## Why not templates

A template folder is a snapshot of one set of decisions. Change one of them and
you are hand-editing generated code forever, and nothing can be added later
because nothing recorded what you chose.

Atarashi records the decisions instead of the output:

```bash
atarashi new my-api --http fastify --db postgres --orm drizzle --auth jwt
cd my-api
atarashi add obs/pino          # three weeks later, in the same project
```

`atarashi add` re-renders what the new blueprint would have contributed and
splices it into your existing files at the slot regions. Files you have edited by
hand are never silently overwritten.

## Install

```bash
npm install -g atarashi
```

Or don't: `npx atarashi@latest` works forever. Node 20.11+.

## Pick what goes in

**A preset**, a set known to work together:

```bash
atarashi new my-api --preset backend-ts
```

| Preset | What it is |
|---|---|
| `backend-ts` | Express + Postgres + Drizzle + JWT + Docker, strict TypeScript |
| `backend-minimal` | Express + TypeScript, validated config, no database |
| `backend-mongo` | Express + MongoDB + Mongoose |
| `fullstack-react` | A TypeScript API with a React + Vite + Tailwind front end |
| `fullstack-angular` | The same with Angular + Tailwind |
| `frontend-only` | React + Vite + Tailwind on its own |

**Shorthands**, the common axes, without learning ids:

```bash
atarashi new my-api --http hono --db sqlite --orm drizzle --tests vitest --lint biome
```

**Blueprints**, the real thing underneath. 36 of them:

```bash
atarashi new my-api --add http/fastify --add db/postgres --add orm/drizzle
atarashi list
```

Or run `atarashi` with no arguments for the wizard.

## How composition works

Blueprints never name each other. They declare capabilities:

```json
{
  "id": "orm/drizzle",
  "provides": ["orm", "orm:drizzle"],
  "requires": ["database:sql"],
  "conflicts": ["orm"]
}
```

So `orm/drizzle` works with Postgres, MySQL or SQLite without knowing which.
Ask for it alone and Atarashi tells you a database is missing and lists the ones
that would satisfy it. Ask for two databases and it refuses, naming both. When
exactly one blueprint can satisfy a requirement, it is added for you.

This indirection is why a project generated weeks ago can still grow a new
capability, and it is the whole reason the system is built this way.

## What you can count on

- **Nothing is written until the plan is valid.** `--dry-run` prints the plan and
  writes nothing. A conflict is an error with a suggested fix, never a
  half-generated directory.
- **Regeneration is byte-identical.** Every project gets an `atarashi.json`
  recording the spec. `--from atarashi.json` reproduces it exactly. (Generated
  secrets in `.env` are the deliberate exception.)
- **It works offline.** The blueprints ship inside the package; the registry is
  an optimisation, not a requirement.
- **Third-party blueprints are not second-class.** They use the same format and
  the same validator as the first-party ones, and their hooks are sandboxed and
  require consent.
- **No runtime dependency.** Nothing Atarashi generates depends on Atarashi.
  `atarashi eject` cuts the last link whenever you want.

## Commands

```text
atarashi                                  Interactive wizard
atarashi new <name> [options]             Create a project
atarashi add <blueprint...>               Add capabilities to an existing project
atarashi list [blueprints|presets]        Browse what's available
atarashi info <blueprint>                 Details for one blueprint
atarashi preset <save|list|delete>        Personal presets
atarashi config <get|set|unset|list|path> User-level settings
atarashi registry <subcommand>            update|list|pin|unpin|verify|clear|add|sources
atarashi doctor [--fix]                   Diagnose environment + project
atarashi create-blueprint <id>            Scaffold + validate a new blueprint
atarashi eject                            Inline blueprints into the project
atarashi completion <bash|zsh|fish>       Shell completions
```

Full reference: [docs/guide/cli.md](./docs/guide/cli.md).

## Write your own blueprint

```bash
atarashi create-blueprint acme/redis
atarashi create-blueprint acme/redis --validate ./acme/redis
```

Publish it as `atarashi-blueprint-*` on npm and anyone can use it:

```bash
atarashi new my-api --add npm:atarashi-blueprint-acme-redis
```

Guide: [Authoring blueprints](./docs/guide/authoring-blueprints.md).

## Documentation

| | |
|---|---|
| [Getting started](./docs/guide/getting-started.md) | The 30-second version and the ideas under it |
| [CLI reference](./docs/guide/cli.md) | Every command and flag |
| [Blueprint catalogue](./docs/guide/blueprints.md) | All 36 blueprints |
| [Presets](./docs/guide/presets/) | What each produces, with file trees |
| [Configuration](./docs/guide/configuration.md) | Settings and precedence |
| [Recipes](./docs/guide/recipes.md) | Common tasks, start to finish |
| [Troubleshooting](./docs/guide/troubleshooting.md) | When something goes wrong |
| [Authoring blueprints](./docs/guide/authoring-blueprints.md) | Writing and publishing one |
| [Plugin API](./docs/guide/plugin-api.md) | `@atarashi/plugin-kit` in detail |

## Upgrading from v0.6

v1 replaces the template-copying engine entirely. Your old command still works
and tells you what it now maps to:

```bash
atarashi new my-api --preset backend-mongo
```

The old preset names are accepted for one minor cycle with a notice.

## Contributing

Blueprints are the most parallelizable work and need no engine knowledge: the
[authoring guide](./docs/guide/authoring-blueprints.md) is the whole contract. See
[CONTRIBUTING.md](./CONTRIBUTING.md).

```bash
pnpm install
pnpm build
pnpm release:check    # every gate: typecheck, lint, test, blueprints, packaging, bench, e2e
```

## License

[MIT](./LICENSE)
