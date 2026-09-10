# Troubleshooting and FAQ

Atarashi tries to make its errors self-explanatory: every one names what went
wrong, where, and at least one thing you can do about it. This page covers the
cases where the message is not the whole story.

Start with:

```bash
atarashi doctor          # checks Node, git, the registry cache and the project
atarashi doctor --fix    # repairs what is safely repairable
```

## Resolution

### "requires `database:sql`, and several blueprints provide it"

```
✖ orm/drizzle requires `database:sql`, and 3 blueprints provide it
    → Add `--add db/postgres` to choose it
    → Add `--add db/mysql` to choose it
    → Add `--add db/sqlite` to choose it
```

An ORM does not pick your database for you. Add the one you want. When exactly
one blueprint can satisfy a requirement, Atarashi adds it silently and tells you
it did; ambiguity is the only case it stops on.

### "Cannot combine db/mysql with db/postgres"

Two blueprints claim the same capability, and the capability allows one provider.
Drop one, as the message suggests. This is also what you will see if a preset
already includes something you added by hand. Start from the preset and use
`--remove`:

```bash
atarashi new my-api --preset backend-ts --remove db/postgres --add db/mysql
```

### "Unknown blueprint `x/y`"

Check the spelling with `atarashi list`. If it is a community blueprint, it needs
to be reachable: `--add npm:atarashi-blueprint-x`, or a source registered with
`atarashi registry add`.

### Everything resolves, but the result is not what you wanted

`--dry-run` prints the plan without writing. It shows every file, every
dependency, every blueprint that got pulled in and why:

```bash
atarashi new my-api --preset backend-ts --dry-run
```

## Generation

### "Refusing to write into a non-empty directory"

Deliberate. Pass `--force` if you mean it, or `--dir` to target somewhere else.
Nothing is written before the whole plan is valid, so a refusal never leaves a
half-generated directory behind.

### A conflict between two blueprints on the same file

Some files can be merged (JSON, YAML, `.env`, `.gitignore`, `package.json`) and
some cannot. When two blueprints write different content to a file with no merge
strategy, Atarashi stops and names both. Choosing one of them is usually the
answer; if you need both, `atarashi eject` and take over the file yourself.

### Two blueprints want incompatible versions of the same dependency

Ranges are intersected. When intersection is empty you get both requesters and
the two ranges. Pin the dependency yourself after generating, or drop one of the
blueprints.

## After generating

### `pnpm install` complains about ignored build scripts

It should not; generated projects declare the packages that need to run build
scripts in `pnpm-workspace.yaml`, for both pnpm 10 (`onlyBuiltDependencies`) and
pnpm 11 (`allowBuilds`). If you hit `ERR_PNPM_IGNORED_BUILDS` anyway, a
dependency you added yourself needs approving:

```bash
pnpm approve-builds
```

### The app exits with "Invalid environment variables"

Config is validated at startup on purpose, so a missing variable is a clear error
at boot rather than `undefined` somewhere deep in a request handler.

Generate with `--write-env` and you get a working `.env`, including a freshly
minted signing key for anything that needs one. Without it you get
`.env.example`, which you copy and fill in:

```bash
cp .env.example .env
```

### `atarashi add` says a file was edited since generation

It compares what the file should look like against what is on disk. If you have
edited it, it will not silently overwrite your work. Your options, in order of
preference: merge the shown diff by hand; keep the slot region markers intact so
future adds can splice cleanly; or `--force`.

Those `// #region atarashi:imports` comments are load-bearing. Delete them and
`atarashi add` loses its insertion point and falls back to reporting a conflict.

### The generated project fails its own lint

That is a bug in Atarashi, not in your setup; a generated project is expected to
pass its own `lint`, `build`, `test` and boot with no edits. Please open an issue
with the exact command you ran.

## Registry and network

### "nothing cached" from `atarashi doctor`

Harmless on a first run. The blueprints that ship inside the package always
resolve, so generation works with no network at all. `atarashi registry update`
fetches the index when you want it.

### Working offline

```bash
atarashi new my-api --preset backend-ts --offline
```

or set it once with `atarashi config set registry.offline true`.

### Everyone on the team should get identical output

Pin the registry and commit `atarashi.json`:

```bash
atarashi registry pin 1.0.0
```

## Exit codes

Useful when scripting; stable within a major version.

| Code | Meaning |
|---|---|
| `0` | Success |
| `1` | Runtime failure (a template or expression blew up) |
| `2` | Usage error: a bad flag, a missing answer, an invalid file |
| `3` | Resolution failure: unknown, ambiguous, conflicting or cyclic blueprints |
| `4` | Merge conflict between blueprints |
| `5` | Filesystem refusal: non-empty target, path escape, case collision |
| `6` | Registry unavailable or failed its integrity check |
| `7` | A post-action failed (install, format, git); the project was still written |
| `130` | Interrupted (Ctrl-C); anything partially written is rolled back |

## FAQ

**Do I have to use pnpm?**
No. `--pm npm|yarn|bun` or `atarashi config set packageManager npm`. Atarashi
detects what you invoked it with by default.

**Can I use it on an existing project?**
`atarashi add` needs an `atarashi.json`, so it works on projects Atarashi
generated. For a project it did not, take the file you want from the
[catalogue](./blueprints.md) and copy it in; the blueprints are readable.

**Can I see what a command will do before it does it?**
Yes. `--dry-run` is on every command that changes anything. `new` and `add`
print the full plan; `config set`, `registry pin`, `preset save`, `eject` and
their siblings report the change and make none.

**What if I want to stop using Atarashi?**
`atarashi eject` inlines everything and removes the link to the registry. What
you are left with is an ordinary project; there is no runtime dependency on
Atarashi in anything it generates.

**Is anything sent anywhere?**
No. Telemetry is off unless you turn it on, `DO_NOT_TRACK` is honoured, and even
when enabled events are written to a local file rather than uploaded.

**Which Node versions are supported?**
Node 20.11 and newer.

**Can I write my own blueprints?**
Yes, and they are not second-class; the first-party ones use exactly the same
format and the same validator. See [Authoring blueprints](./authoring-blueprints.md).
