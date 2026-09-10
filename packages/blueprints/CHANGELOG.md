# @atarashi/blueprints

## 1.0.0

### Patch Changes

- ec1979b: Close two gaps against doc 09 § T5 and § T7. Generated `.gitignore` files now
  carry `.env*` with a `!.env.example` negation, where before only `.env` and
  `.env.*.local` were ignored, leaving `.env.local` and `.env.production`
  committable, which is exactly the leak that section is about. Both CI blueprints
  gained the secret-scanning step the doc promised. And `ATARASHI_TELEMETRY=0` and
  `CI=true` now disable telemetry alongside `DO_NOT_TRACK`, as documented.
- ec1979b: Make a generated project install, build, lint, test and boot with no manual
  steps. Blueprints that pull a dependency needing a build script declare it, and
  the merged result is written to `pnpm-workspace.yaml` for both pnpm 10
  (`onlyBuiltDependencies`) and pnpm 11 (`allowBuilds`), so a plain `pnpm install`
  no longer fails with `ERR_PNPM_IGNORED_BUILDS`. `validation/zod` loads `dotenv`
  before anything reads the environment; `obs/pino` imports the named `pinoHttp`
  export rather than a namespace TypeScript cannot call; `web/react-vite-tailwind`
  drops a `.tsx` import extension; `db/sqlite` moves to a `better-sqlite3` with a
  prebuild for current Node; the generated Biome config turns off the
  `organizeImports` assist, which sorts imports across the slot markers `atarashi
add` needs; and both vitest setups pass when a new project has no tests yet.
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
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
  - @atarashi/schema@1.0.0
