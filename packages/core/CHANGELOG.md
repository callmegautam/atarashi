# @atarashi/core

## 1.0.0

### Minor Changes

- ec1979b: Hold an untrusted blueprint to the reviewed version manifest. Doc 09 § T3 said a
  blueprint "cannot introduce an arbitrary package silently"; in practice the
  manifest was only a fallback, so a blueprint that pinned its own range added
  whatever it liked: `--add npm:atarashi-blueprint-x` could pull any package at
  any version into the user's project. A blueprint the registry did not mark
  trusted may now only add dependencies the manifest pins, and gets the reviewed
  range rather than the one it asked for. Trusted blueprints may still pin their
  own, which the conformance suite reports.
- ec1979b: Let an env entry declare `generate` (`hex-32`, `hex-64` or `base64url-32`),
  which fills `.env` (never the committed `.env.example`) with a fresh random
  value. A required signing key was correctly blank in the example and therefore
  blank in `.env` too, which stopped a generated project on its own env
  validation. This is the one part of a generation that is deliberately not
  reproducible run to run.
- ec1979b: Refuse an install script from an untrusted blueprint. Doc 09 § T3 claimed
  blueprints could not declare `postinstall`/`preinstall`/`prepare`; nothing
  enforced it, and a community blueprint installed from npm could put arbitrary
  code into a generated `package.json` by three separate routes: its `scripts`
  map, a `json-deep` contribution, or a `package.json` it rendered from a
  template. All three converge on the merger, which now refuses any of the seven
  npm lifecycle scripts from a blueprint the registry did not mark trusted, and
  fails the generation before anything is written. Trust is the line rather than
  the script name, so the two reviewed first-party blueprints that need one
  (`orm/prisma`, `meta/husky`) keep working, and a test pins that list.
- ec1979b: Run blueprint hooks in a restricted worker thread. A hook gets an empty
  environment, no `fetch`, no filesystem or subprocess builtins, no imports from
  outside its own blueprint, and a hard timeout; it mutates a structured clone of
  what its declared capabilities allow it to see, and only the permitted fields
  are copied back. Untrusted blueprints need explicit consent, `--no-hooks` skips
  every hook with a warning, and everything a hook returns is re-validated before
  it can reach disk.

### Patch Changes

- ec1979b: Ship a README, a LICENSE and repository metadata in every published package

  Every publishable package listed `README.md` in `files[]`, but `atarashi`,
  `@atarashi/plugin-kit` and `@atarashi/blueprints` had no README on disk, so npm
  quietly omitted it and their package pages would have rendered blank. The three
  now have one, written for the audience that arrives on npm rather than on
  GitHub. No package carried the MIT text either, despite declaring
  `license: MIT`, and none carried `repository`, `homepage`, `bugs` or `author`,
  so nothing on npm linked back to the source or the issue tracker.

  `pnpm check:packaging` now fails when a `files[]` entry does not exist on disk.
  publint does not flag that, npm omits the entry without a word, and the first
  symptom is a blank page after publishing.

- ec1979b: Refuse to write through a symlinked directory in the target. `mkdir -p` and
  `rename` both follow a symlink, so a `src -> /etc` planted in the target
  redirected `src/index.ts` outside it; the existing path checks only reason
  about the string, which looks harmless. Every parent component is now `lstat`-ed
  before the move. This matters most for `atarashi add`, which runs inside a
  repository the user may have cloned from somewhere they do not control.

  Interruption is also reported as its own diagnostic and exits 130, rather than
  being indistinguishable from a write failure.

- ec1979b: Keep the whitespace around a slot. Handlebars consumes the newline that ends a
  _standalone_ partial's line, and every `{{> slot}}` is written as one, so the
  blank line a template puts after a slot was swallowed and a file ending in one
  lost its trailing newline, both rejected by a generated project's own
  formatter. The slot partial now puts that newline back, `injectSlots` ends a
  filled `imports` region with a blank line so the region reads as imports rather
  than imports-then-code, and the conformance suite rejects a slot written inline,
  which is the one shape the fix does not hold for.
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
  - @atarashi/schema@1.0.0
