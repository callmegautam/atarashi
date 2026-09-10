---
'@atarashi/blueprints': patch
---

Make a generated project install, build, lint, test and boot with no manual
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
