# Recipes

Complete tasks, start to finish.

## Add auth to a project you already generated

```bash
cd my-api
atarashi add auth/jwt --dry-run   # see the diff first
atarashi add auth/jwt
```

What happens: Atarashi reads `atarashi.json`, re-renders the project as it would
look with `auth/jwt` included, and splices the difference into the slot regions of
your existing files. New files are written whole; existing files gain only the
lines the blueprint contributes.

Then:

```bash
pnpm install
cp .env.example .env     # JWT_SECRET is new, fill it in
pnpm dev
```

If a file you have edited by hand is in the way, you get a diff and a choice
rather than a silent overwrite. Keep the `// #region atarashi:…` markers intact
and the splice keeps working no matter how much else you change around them.

## Use it in CI

Generation is deterministic and non-interactive when you ask it to be. In a
workflow:

```yaml
- run: npx atarashi@latest new service --preset backend-ts --yes --no-install --json > plan.json
```

The rules that matter in CI:

- `--yes` accepts every default; without a TTY, prompts are errors that name the
  missing flag rather than a hang.
- `--json` puts a stable object on stdout and progress on stderr, so redirecting
  stdout is safe.
- `--offline` works with no network at all; the bundled blueprints always
  resolve.
- Pin the registry (`--registry 1.0.0`) so a build in six months produces what it
  produces today.

To check that a project still regenerates identically, a useful guard against
someone hand-editing a generated file:

```bash
atarashi new check --from ./atarashi.json --dir /tmp/check --no-install --no-git
diff -r --exclude=node_modules --exclude=.env . /tmp/check
```

`.env` is expected to differ: anything with a generated signing key is minted
fresh each time, on purpose.

## Standardise a stack across a team

Generate the project you want once, then save it:

```bash
cd my-api
atarashi preset save acme-service
atarashi preset list
```

Now anyone with that preset gets the same stack:

```bash
atarashi new next-service --preset acme-service
```

For a whole team, commit an `atarashi.json` to a template repo and have people
use `--from`, or publish a blueprint package (see below). Pin the registry so
everyone resolves the same blueprint versions.

## Fork a blueprint

When a first-party blueprint is nearly right:

```bash
cd my-api
atarashi eject
```

Eject copies the blueprints into `./.atarashi/blueprints/` and points the project
at them. They are ordinary directories; edit them, and the next `atarashi add`
uses your copy. Local blueprints take precedence over everything else, so a fork
shadows the original by id.

To take one blueprint rather than all of them, copy just that directory out of
the catalogue into `./.atarashi/blueprints/<namespace>/<name>/`.

## Write and publish a blueprint

```bash
atarashi create-blueprint acme/redis
atarashi create-blueprint acme/redis --validate ./acme-redis
atarashi create-blueprint acme/redis --test ./acme-redis
```

To share it, publish it as an npm package named `atarashi-blueprint-*`:

```bash
npm publish        # package name: atarashi-blueprint-acme-redis
```

Anyone can then use it:

```bash
atarashi new my-api --add npm:atarashi-blueprint-acme-redis
```

Full guide: [Authoring blueprints](./authoring-blueprints.md).

## Generate a JavaScript project instead of TypeScript

```bash
atarashi new my-api --add core/node-js --add http/express --add mw/error-handler
```

`core/node-ts` is the default only when nothing else in your selection provides a
language. Blueprints that support both ship both variants and pick with a `when`
expression.

## Swap the linter, the test runner, or the logger

Every one of these is a capability with more than one provider, so it is a
`--remove`/`--add` pair:

```bash
atarashi new my-api --preset backend-ts \
  --remove lint/eslint-prettier --add lint/biome \
  --remove test/vitest         --add test/jest \
  --remove obs/pino            --add obs/morgan-logger
```

The same works after the fact with `atarashi add`, though removing a blueprint
from an existing project is not automated; the files it wrote are yours now.

## Run a database locally

Add the Compose file and start it:

```bash
atarashi new my-api --preset backend-ts --add infra/docker-compose
cd my-api
docker compose up -d
pnpm db:push
pnpm dev
```

The `DATABASE_URL` in `.env.example` already matches the Compose service, so
copying it to `.env` is enough.

## See exactly what a preset produces before using it

```bash
atarashi info preset/backend-ts
atarashi new tmp --preset backend-ts --yes --dry-run
```

Or read the [preset pages](./presets/), which are generated from real plans and
show the full file tree.
