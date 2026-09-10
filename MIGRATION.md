# Migrating from Atarashi v0.6

v1 replaces the engine. v0.6 copied one of five template folders into a new
directory; v1 composes small blueprints into a project and records what you
chose. Nothing about your existing projects breaks — they are ordinary projects
with no dependency on Atarashi — but the CLI contract has changed.

**The short version:** your old command still works and tells you what it now
maps to. Read the [compatibility table](#your-old-command) and you are probably
done.

## Your old command

Old template names are accepted for one minor cycle, with a notice:

```console
$ atarashi new my-api --preset backend-mysql
⚠ `backend-mysql` is now the `backend-ts` preset (-db/postgres, +db/mysql).
  Run:  atarashi new <name> --preset backend-ts --add db/mysql --remove db/postgres
  Continuing with the equivalent configuration…
```

| v0.6 template | v1 equivalent |
|---|---|
| `backend-pgsql` | `--preset backend-ts` (Postgres + Drizzle are already in it) |
| `backend-mysql` | `--preset backend-ts --remove db/postgres --add db/mysql` |
| `backend-mongo` | `--preset backend-mongo` |
| `angular-tailwind` | `--preset fullstack-angular` |

`backend-mongo` is both an alias and a real preset. The real preset wins, so
`--preset backend-mongo` gives you the Mongo stack directly.

These aliases are removed in v1.2. Move to the preset names when convenient.

## What changed

| v0.6 | v1 |
|---|---|
| `atarashi` prompts for a name and a template | `atarashi` opens a wizard; `atarashi new <name>` is the direct path |
| Four template names | Six presets and 36 composable blueprints |
| No flags | A full non-interactive flag surface, `--json`, `--dry-run` |
| Copies a folder verbatim | Composes blueprints and substitutes real values |
| Node version unspecified | Node 20.11+ |
| Nothing recorded | `atarashi.json` records the spec, so `atarashi add` works later |

## What this buys you

**The hardcoded values are gone.** v0.6 templates shipped `"name": "configs"`,
the maintainer's name as `author`, `"license": "ISC"` in an MIT repo,
`"packageManager": "pnpm@10.11.1"`, and an `.env.sample` full of `DEMO`. All of
those are now real values derived from your project, your config, and the package
manager you actually invoked.

**Drift is gone.** `backend-mysql` shipped both `utils/asyncHandler.ts` and
`utils/async-handler.ts`; the Mongo template's README described a
`drizzle.config.ts` it did not have. There is one canonical form per concern now,
because there is one blueprint per concern.

**You can add things later.**

```bash
cd my-api
atarashi add auth/jwt
```

This is the change that matters most. In v0.6, anything you did not pick at
creation time you added by hand forever.

**You can mix freely.** The templates were four fixed points. The blueprints
compose:

```bash
atarashi new my-api --http hono --db sqlite --orm drizzle --tests vitest --lint biome
```

## Moving an existing v0.6 project

There is no automated upgrade, and you do not need one — a v0.6 project is a
normal project that will keep working untouched.

If you want it to benefit from `atarashi add`, generate the v1 equivalent next to
it and move your code across:

```bash
atarashi new my-api-v1 --preset backend-ts --dry-run   # check the shape first
atarashi new my-api-v1 --preset backend-ts
diff -r my-api/src my-api-v1/src
```

The layout is deliberately close to what the templates produced —
`src/config/env`, `src/routes`, `src/middlewares`, `src/lib` — so this is usually
a matter of copying your handlers over. What you gain is `atarashi.json` and the
ability to keep growing the project.

Two differences to expect:

- **Config is validated at startup.** `src/config/env.ts` parses `process.env`
  through Zod and exits with a clear message if something is missing, rather than
  handing you `undefined` deep inside a request handler. Import `env` from there
  instead of reading `process.env` directly.
- **Slot markers are load-bearing.** Those `// #region atarashi:imports` comments
  are where `atarashi add` splices new code. Edit freely around them; deleting
  them costs you the ability to add cleanly later.

## If you were using the templates as a starting point to fork

That still works, and it is now a supported path rather than a copy-paste:

```bash
atarashi new my-api --preset backend-ts
cd my-api
atarashi eject
```

Eject copies the blueprints into `./.atarashi/blueprints/` and points the project
at them. Edit them and they are yours. Local blueprints win over every other
source.

## Things that are gone

- **`templates/`** — reproduced as compositions. The
  [preset pages](./docs/guide/presets/) show exactly what each produces.
- **Committed lockfiles inside templates** — a blueprint never ships one, so you
  resolve against current versions rather than whatever was current when the
  template was committed.
- **The `frontend` template** — replaced by `web/react-vite-tailwind`,
  `web/angular-tailwind` and `web/next`, which compose with a backend or stand
  alone.

## Staying on v0.6

v0.6 is not deprecated on npm and keeps working. v1 is a major version and opt-in:

```bash
npx atarashi@0.6.0        # pinned to the old engine
npx atarashi@latest       # v1
```

## Help

- [Getting started](./docs/guide/getting-started.md)
- [Troubleshooting and FAQ](./docs/guide/troubleshooting.md)
- [Blueprint catalogue](./docs/guide/blueprints.md)

If your v0.6 workflow has no v1 equivalent, that is a bug worth reporting — open
an issue with the command you used to run.
