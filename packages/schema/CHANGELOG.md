# @atarashi/schema

## 1.0.0

### Minor Changes

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
