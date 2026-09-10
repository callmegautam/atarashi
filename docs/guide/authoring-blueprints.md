# Authoring blueprints

A blueprint is a directory with a `blueprint.json` and some template files.
That is the whole format. The 36 first-party blueprints use exactly this: there
is no privileged path, and the validator that gates a release is the same one you
run locally.

The `blueprint.json` fields are covered inline below;
this page is the path from nothing to a published package.

## Scaffold one

```bash
atarashi create-blueprint acme/redis
```

You get:

```text
acme/redis/
├── blueprint.json
└── files/
    └── README.md
```

The id is `<namespace>/<name>` and, inside a catalogue, it must match the
directory path. Namespaces are how the catalogue stays navigable; pick one that
is yours.

## The manifest

```json
{
  "manifestVersion": 1,
  "id": "acme/redis",
  "name": "Redis",
  "version": "1.0.0",
  "description": "A shared Redis client with connection handling.",
  "category": "cache",

  "provides": ["cache", "cache:redis"],
  "requires": ["runtime:node", "config:env"],
  "conflicts": ["cache"],

  "files": [
    { "from": "files/client.ts.hbs", "to": "src/lib/redis.ts" }
  ],
  "dependencies": { "ioredis": "^5.4.1" },
  "env": [
    {
      "key": "REDIS_URL",
      "sample": "redis://localhost:6379",
      "description": "Redis connection string",
      "required": true
    }
  ]
}
```

The three capability lists are the design work; everything else is mechanical.

- **`provides`**: what the project can now do. Declare both the general
  capability (`cache`) and the specific one (`cache:redis`), so another blueprint
  can require either "some cache" or "Redis in particular".
- **`requires`**: what must be present. Requiring `database:sql` rather than
  `db/postgres` is what lets your blueprint work with all three SQL databases.
  When exactly one blueprint satisfies a requirement it is added automatically;
  when several do, the user is asked.
- **`conflicts`**: the capabilities that may only have one provider. A cache
  blueprint conflicting on `cache` is the normal "only one of these" pattern.

Never name another blueprint where a capability will do. That indirection is the
entire reason composition works.

## Templates

Files under `files/` ending in `.hbs` are rendered with Handlebars against a
fixed context:

| Root | What it holds |
|---|---|
| `project` | `name`, `slug`, `pascal`, `camel`, `kebab`, `constant`, `description`, `year` |
| `pm` | `name`, `install`, `run`, `exec`, `add`, `addDev`, `lockfile` |
| `options` | The resolved project options: license, author, package manager |
| `answers` | Every prompt answer, keyed by prompt name |
| `atarashi` | `version`, `generatedAt` |
| `blueprints` | The resolved list, as `{ id, version }` |

The helper set is deliberately small: `eq`, `ne`, `and`, `or`, `not`, `json`,
`case`, `indent`, `join`, plus `{{#when}}`, `{{expr}}` and `{{#ifHas}}`. There is
no `lookup` and no dynamic partials. If you need real logic, use a hook, where
the escape hatch is visible and sandboxed.

```handlebars
import Redis from 'ioredis';
import { env } from '../config/env.js';

export const redis = new Redis(env.REDIS_URL{{#when "answers.redis.tls"}}, { tls: {} }{{/when}});
```

A file that should not be rendered (a binary, or something already full of
braces) sets `"render": false`.

Dotfiles ship as `_gitignore` and are written as `.gitignore`, so they are not
swallowed by npm or by your own tooling.

## Contributing to other blueprints' files

Two mechanisms, and which one you want depends on the file.

**Slots** insert lines into another blueprint's source at a named region:

```json
{
  "contributions": [
    {
      "target": "src/config/env.ts",
      "slot": "env-schema",
      "value": "REDIS_URL: z.string().url(),"
    },
    {
      "target": "src/index.ts",
      "slot": "bootstrap",
      "value": "await redis.ping();"
    }
  ]
}
```

The target file must declare the region with `{{> slot \"env-schema\" }}`, alone
on its own line; the validator enforces that, because the renderer relies on it.
Contributions to the `imports` slot are merged, so six blueprints importing from
the same module produce one import statement.

**Merges** combine structured files:

```json
{
  "target": "tsconfig.json",
  "merge": "json-deep",
  "value": { "compilerOptions": { "types": ["ioredis"] } }
}
```

Strategies: `json-deep`, `yaml-deep`, `env`, `lines-unique`, `append`, `prepend`,
`overwrite`, and `error` (the default for anything unrecognised: two blueprints
writing the same file is a conflict unless one of them says how to combine).
Arrays union by value, so contributing `["ioredis"]` to a `types` array that
already has `["node"]` leaves both.

## Conditions

Anywhere you see `when`, it takes an expression over the same context:

```json
{ "from": "files/client.ts.hbs", "to": "src/lib/redis.ts", "when": "provides('language:typescript')" }
```

Operators are `&& || ! === !== < <= > >= + - ( )` with string, number and boolean
literals, plus `has('<id>')` and `provides('<capability>')`. Prefer `provides`;
`has` ties you to a specific blueprint.

## Prompts

```json
{
  "prompts": [
    {
      "name": "redis.tls",
      "type": "confirm",
      "message": "Connect over TLS?",
      "default": false,
      "flag": "--redis-tls"
    }
  ]
}
```

Prompt names are globally unique across a generation, so namespace them with your
blueprint. Every prompt needs a `flag`, because a non-interactive run has to be
able to answer it; the validator will tell you if you forget.

## Hooks

For the rare thing a template cannot express:

```ts
import { defineHooks } from '@atarashi/plugin-kit';

export default defineHooks({
    beforeRender(subject, context) {
        subject.answers['redis.db'] ??= 0;
    },
    afterPlan(plan) {
        plan.summary.nextSteps.push('Start Redis:  docker run -p 6379:6379 redis');
    },
});
```

Declare it in the manifest, and declare exactly the capabilities it needs. The
sandbox denies anything not listed, and kills the worker past the timeout:

```json
{
  "hooks": {
    "module": "hooks.js",
    "exports": ["beforeRender", "afterPlan"],
    "capabilities": ["read-context"],
    "timeoutMs": 5000
  }
}
```

Hooks run in a worker thread with no filesystem or network access unless granted.
A blueprint from an untrusted source needs explicit consent before its hooks run
at all.

## Validate and test

```bash
atarashi create-blueprint acme/redis --validate ./acme/redis
atarashi create-blueprint acme/redis --test ./acme/redis
```

`--validate` runs the conformance suite: the manifest parses, every `files[].from`
exists, nothing is shipped that no entry claims, every template parses and only
references things the context provides, every `when` expression parses, every
prompt has a flag, no lockfile is committed, `nextSteps` placeholders resolve, and
slots are written standalone.

`--test` generates a project with your blueprint in it and checks that the result
is coherent.

This is the same suite the first-party blueprints must pass before a release. If
it is green, your blueprint will not surprise anyone.

## Publish it

Package it for npm. The name must match `atarashi-blueprint-*` (an npm scope is
allowed), and an `atarashi` field points at the directory holding
`blueprint.json`:

```json
{
  "name": "atarashi-blueprint-acme-redis",
  "version": "1.0.0",
  "atarashi": "./blueprint",
  "files": ["blueprint"]
}
```

```bash
npm publish
```

Consumers install it and name the package; the blueprint id comes from your
manifest:

```bash
npm install atarashi-blueprint-acme-redis
atarashi new my-api --add npm:atarashi-blueprint-acme-redis
```

A blueprint loaded from npm is **untrusted**, and three things follow from that:

- Its **hooks require consent** before they run.
- It **cannot add an install script**: `postinstall`, `preinstall`, `prepare`
  and the rest are refused, whether declared in `scripts`, contributed into
  `package.json`, or written by a template. Use a named script and a `nextSteps`
  line instead.
- It **can only add dependencies the registry version manifest pins**, and gets
  the reviewed range. If your blueprint needs a package that is not in the
  manifest, open a PR to add it; that review is the point.

None of these apply to a blueprint the user has vendored into
`./.atarashi/blueprints`, because at that point they have read it. Design for the
untrusted case: a blueprint that needs no hooks, no install script and no exotic
dependency is one people will actually adopt.

## Local blueprints

While developing, put the directory in `./.atarashi/blueprints/<namespace>/<name>/`
inside a generated project. Local blueprints win over every other source, so you
can shadow a first-party one by id and iterate without publishing anything.

`atarashi eject` does this for you with the blueprints a project already uses.

## Checklist before you publish

- [ ] `--validate` is clean
- [ ] `--test` generates a coherent project
- [ ] `requires` names capabilities, not blueprint ids
- [ ] Every prompt has a `flag` and a namespaced `name`
- [ ] Secrets in `env` are `secret: true`, and use `generate` if the app needs a
      real value to boot
- [ ] A JavaScript variant exists, or `when` restricts you to TypeScript
- [ ] The `description` reads like a sentence; it is what `atarashi list` shows
