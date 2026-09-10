# @atarashi/plugin-kit

## 1.0.0

### Patch Changes

- ec1979b: Wire `npm:` blueprint packages through the CLI. `atarashi new --add
npm:atarashi-blueprint-x` and `atarashi add npm:…` now register the package with
  the registry and resolve it to the blueprint id its manifest declares; before
  this the registry could load such a package but nothing ever asked it to. The
  conformance suite no longer holds a blueprint that a package's `atarashi` field
  points at to the `<namespace>/<name>` directory convention, which only applies
  to blueprints found by scanning a catalogue.
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
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
  - @atarashi/core@1.0.0
  - @atarashi/registry@1.0.0
  - @atarashi/schema@1.0.0
