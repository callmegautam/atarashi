# Configuration

Atarashi reads settings from four places. Anything you can set in a config file
you can override for one run with a flag, and anything you can set with a flag you
can make the default in the config file.

## Precedence

Highest wins:

1. **CLI flags**: `--pm npm`, `--no-git`, `--license Apache-2.0`
2. **Environment variables**: `ATARASHI_*`
3. **User config**: `config.json` (see below)
4. **Built-in defaults**: including package-manager detection

When you generate from an existing project (`--from atarashi.json`, or
`atarashi add` inside a generated project), that project's own recorded options
are merged in first and then the chain above applies on top.

## Where the user config lives

| Platform | Path |
|---|---|
| Linux | `$XDG_CONFIG_HOME/atarashi/config.json`, else `~/.config/atarashi/config.json` |
| macOS | `~/Library/Application Support/atarashi/config.json` |
| Windows | `%APPDATA%\atarashi\config.json` |

`ATARASHI_CONFIG_DIR` overrides all three. `atarashi config path` prints the one
in effect, and `atarashi config list` prints the current values.

## Managing it

```bash
atarashi config list                       # everything currently set
atarashi config get packageManager
atarashi config set packageManager pnpm
atarashi config set author.name "Your Name"
atarashi config unset license
atarashi config path
```

Every write is validated against the schema before it lands, so a typo is an
error rather than a setting that silently does nothing. Add `--dry-run` to any
of them to see the change without making it.

## Every setting

| Key | Type | What it does |
|---|---|---|
| `packageManager` | `pnpm` \| `npm` \| `yarn` \| `bun` | Which package manager generated projects use. Default: detected from `npm_config_user_agent`, then a lockfile, then `pnpm`. |
| `git` | boolean | Run `git init` in a new project. |
| `install` | boolean | Install dependencies after generating. |
| `format` | boolean | Run the project's formatter after generating. |
| `initialCommit` | boolean | Make the first commit. Requires `git`. |
| `license` | string \| null | SPDX id used by `meta/license` and `package.json`. `null` means no license file. |
| `author.name` | string | Written into `package.json` and the license. |
| `author.email` | string | As above. Validated as an email address. |
| `author.url` | string | As above. Validated as a URL. |
| `registry.sources` | array | Extra blueprint sources. See [Authoring blueprints](./authoring-blueprints.md). |
| `registry.pin` | semver \| null | Pin the registry index to one version, so a team generates identically. |
| `registry.offline` | boolean | Never reach the network; use the cache and the bundled blueprints. |
| `telemetry` | boolean | Off unless you turn it on. See below. |
| `updateNotifier` | boolean | The once-a-day "a newer version exists" line. |

## Environment variables

Useful in CI, where you want the settings without a config file on disk.

| Variable | Equivalent |
|---|---|
| `ATARASHI_PACKAGE_MANAGER` | `packageManager` |
| `ATARASHI_GIT` | `git` (`true` / `false`) |
| `ATARASHI_INSTALL` | `install` (`true` / `false`) |
| `ATARASHI_LICENSE` | `license` |
| `ATARASHI_AUTHOR_NAME` | `author.name` |
| `ATARASHI_AUTHOR_EMAIL` | `author.email` |
| `ATARASHI_AUTHOR_URL` | `author.url` |
| `ATARASHI_OFFLINE` | `registry.offline` (`1` / `true`) |
| `ATARASHI_CONFIG_DIR` | Directory holding `config.json` |
| `DO_NOT_TRACK` | Disables telemetry regardless of any other setting |

## A project's own config

Every generated project gets an `atarashi.json` recording the spec it came from:
the blueprints, the answers, and the options. It is what makes `atarashi add`
possible later, and regenerating from it reproduces the project byte for byte.

Commit it. The one thing it does not contain is anything secret: values that
belong in `.env` stay in `.env`.

```bash
atarashi new my-api --from ./atarashi.json    # rebuild the same project
atarashi preset save my-stack                 # turn it into a reusable preset
```

The single exception to byte-for-byte reproduction is an env entry that mints a
value, such as a JWT signing key. Those land in `.env`, which is
gitignored and per-machine, and they are deliberately different every time.

## Telemetry

Off by default, and there is nothing to opt out of unless you opt in first.
`DO_NOT_TRACK` is honoured. When enabled, events are written to a local file you
can read; nothing leaves your machine.

```bash
atarashi config set telemetry true
atarashi config unset telemetry
```

## Registry pinning

By default Atarashi refreshes its registry index once a day. To make a team's
output identical, pin it:

```bash
atarashi registry pin 1.0.0
atarashi registry list           # what the pinned index contains
atarashi registry unpin
atarashi registry pin 1.1.0 --dry-run   # what would change, without changing it
```

When a pin is in effect the generated `atarashi.json` records it, so `--from`
reproduces against the same blueprint versions rather than whatever is newest
today.
