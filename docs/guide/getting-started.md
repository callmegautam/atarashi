# Getting started

Atarashi builds a project out of **blueprints**: small, composable units that
each add one capability. You pick the capabilities; it resolves them, renders
them, and merges them into a single coherent project.

You do not need to install anything to try it.

## 30 seconds

```bash
npx atarashi@latest new my-api --preset backend-ts --yes
cd my-api
pnpm dev
```

That gives you an Express API in strict TypeScript with Postgres and Drizzle,
Zod-validated config, JWT auth, Pino logging, CORS/Helmet/rate-limiting, ESLint and
Prettier, Vitest, a Dockerfile, a Compose file for the database, and a GitHub
Actions workflow. It installs, builds, lints, boots, and answers `GET /health` with
no edits from you.

Drop `--yes` to be asked instead of accepting the defaults, or drop `--preset` too
and get the full wizard:

```bash
npx atarashi@latest
```

## Installing it properly

```bash
npm install -g atarashi     # or: pnpm add -g atarashi
atarashi --version
```

`npx atarashi@latest` is fine forever; installing globally just saves the
download on each run.

## Choosing what goes in

There are three ways to pick, and they mix freely.

**A preset** is a named set that is known to work together. `atarashi list presets`
shows them; each one has [its own page](./presets/) with the exact file tree it
produces.

```bash
atarashi new my-api --preset backend-ts
```

**Shorthand flags** cover the common axes without you learning blueprint ids:

```bash
atarashi new my-api --http fastify --db postgres --orm drizzle --auth jwt --tests vitest
```

**Blueprint ids** are the real thing underneath, and there is nothing the
shorthands can express that these cannot:

```bash
atarashi new my-api --add http/fastify --add db/postgres --add orm/drizzle
```

Start from a preset and adjust it. This is the usual shape of a real command:

```bash
atarashi new my-api --preset backend-ts --remove obs/pino --add obs/morgan-logger
```

`atarashi list` shows every blueprint; `atarashi info db/postgres` explains one.

## Seeing it before it writes

`--dry-run` prints the full plan (every file, every dependency, every conflict)
and writes nothing:

```bash
atarashi new my-api --preset backend-ts --dry-run
```

Nothing reaches your disk until the plan is complete and valid. If two blueprints
disagree, you get the conflict and a suggested resolution instead of a
half-written directory.

## Adding to a project later

The blueprints you chose are recorded in `atarashi.json`, so Atarashi can come
back to a project it generated weeks ago and add to it:

```bash
cd my-api
atarashi add auth/jwt
```

It renders what the new blueprint would have contributed and splices it into the
slot regions: those `// #region atarashi:imports` comments in your source. Files
you have edited by hand since generation are never overwritten silently; you get
a diff and a choice.

## Where things are

| You want | Read |
|---|---|
| Every command and flag | [CLI reference](./cli.md) |
| What blueprints exist | [Blueprint catalogue](./blueprints.md) |
| What each preset produces | [Presets](./presets/) |
| Settings and their precedence | [Configuration](./configuration.md) |
| Common tasks, start to finish | [Recipes](./recipes.md) |
| Something went wrong | [Troubleshooting](./troubleshooting.md) |
| Writing your own blueprint | [Authoring blueprints](./authoring-blueprints.md) |

## The one idea worth understanding

Blueprints do not name each other. They declare **capabilities**: what they
provide, what they require, what they conflict with. The resolver works out
the rest.

`orm/drizzle` requires `database`. It does not care which one. So this works:

```bash
atarashi new my-api --add orm/drizzle --add db/mysql
```

and so does the same command with `db/postgres` or `db/sqlite`. Ask for
`orm/drizzle` alone and Atarashi tells you a database is missing and lists the
ones that would satisfy it. Ask for two databases and it refuses, naming both.

This is why adding a capability to an existing project works at all, and it is
the whole reason the system is built the way it is.
