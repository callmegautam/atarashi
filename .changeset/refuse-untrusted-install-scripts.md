---
'@atarashi/core': minor
'@atarashi/schema': minor
'@atarashi/blueprints': patch
---

Refuse an install script from an untrusted blueprint. Doc 09 § T3 claimed
blueprints could not declare `postinstall`/`preinstall`/`prepare`; nothing
enforced it, and a community blueprint installed from npm could put arbitrary
code into a generated `package.json` by three separate routes: its `scripts`
map, a `json-deep` contribution, or a `package.json` it rendered from a
template. All three converge on the merger, which now refuses any of the seven
npm lifecycle scripts from a blueprint the registry did not mark trusted, and
fails the generation before anything is written. Trust is the line rather than
the script name, so the two reviewed first-party blueprints that need one
(`orm/prisma`, `meta/husky`) keep working, and a test pins that list.
