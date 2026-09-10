---
'@atarashi/blueprints': patch
'@atarashi/plugin-kit': patch
'@atarashi/registry': patch
'@atarashi/schema': patch
'@atarashi/core': patch
'atarashi': patch
---

Ship a README, a LICENSE and repository metadata in every published package

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
