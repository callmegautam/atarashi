---
"atarashi": minor
---

Add `atarashi remove`, `atarashi update` and `atarashi status`, so a generated
project can do more than grow.

- `atarashi remove <blueprint...>` takes blueprints back out: their files,
  dependencies, slot contributions, env vars and answers. It refuses when a
  blueprint that stays still needs one being removed, and names blueprints that
  were probably only there for it.
- `atarashi update` re-applies newer blueprint versions, using what
  `atarashi.json` generated as the base. Untouched files are replaced, edited
  files are merged three ways (`package.json` and other JSON key by key), and
  changes that overlap your edits are printed and left for you. `--dry-run`
  shows the whole diff first.
- `atarashi status` lists the recorded blueprints with any newer versions, the
  generated files edited or deleted since, and how many files an update would
  touch.

For a project written by an older release, these fetch that release's
`@atarashi/blueprints` from npm once, verify its integrity and cache it, so the
original render can be reproduced exactly.
