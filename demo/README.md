# The demo recording

`atarashi.tape` is the source; `atarashi.gif` is the artefact embedded in the
root README and the docs site. The tape is committed, the GIF is regenerated
whenever the CLI's output changes.

## Producing it

Needs [VHS](https://github.com/charmbracelet/vhs) and `ttyd`:

```bash
brew install vhs          # or: go install github.com/charmbracelet/vhs@latest
```

VHS records whatever `atarashi` resolves to on `PATH`, so link the local build
first; a recording of a published version is a recording of the wrong thing:

```bash
pnpm build
npm link --workspace packages/cli     # or: export PATH="$PWD/node_modules/.bin:$PATH"
vhs demo/atarashi.tape
```

Then embed it in the README, replacing the `<!-- TODO(M7) -->` line:

```markdown
![Atarashi composing a project, then adding a capability to it](./demo/atarashi.gif)
```

## What it shows, and why

Four beats, in this order, because they are the argument for the whole design:

1. **Compose from capabilities.** `--http fastify --db postgres --orm drizzle
   --auth jwt`, with no template name anywhere.
2. **The decisions are recorded.** `atarashi.json` is what makes step 3 possible
   and is the thing a template folder can never have.
3. **Add to a project that already exists.** `atarashi add obs/pino`, then
   `git diff --stat` so the viewer sees it edited existing files rather than
   scattering new ones.
4. **It refuses what cannot work.** `--add orm/drizzle` alone, and the error
   naming the three databases that would satisfy it.

Beat 3 is the one that sells it. Do not cut it for length.

## Rules for changing the tape

- **Keep it under 40 seconds.** Nobody watches more.
- **Never record with the operator's real config or cache.** The tape sets
  `ATARASHI_CONFIG_DIR` to a temporary directory in a `Hide` block for exactly
  this reason. Do not remove it.
- **Never fake output.** Everything on screen must be what the command actually
  prints. If a beat is unimpressive, fix the CLI rather than the recording.
- **Re-record when the output changes.** A GIF showing output the binary no
  longer produces is worse than no GIF. `pnpm check:docs` catches the same class
  of drift for the written docs; this one is on you.

## Alternative: asciinema

For a copy-pasteable, text-selectable recording rather than a GIF:

```bash
asciinema rec demo/atarashi.cast --command "bash demo/script.sh"
agg demo/atarashi.cast demo/atarashi.gif
```

The tape stays the canonical description of what the demo shows either way.
