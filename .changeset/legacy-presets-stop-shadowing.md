---
'atarashi': patch
---

Stop the v0.6 template aliases from producing unresolvable projects. `--preset
backend-mongo` took the deprecation path and rewrote to `backend-ts +
db/mongodb`, conflicting with the `db/postgres` already in that preset; a real
preset now wins over an alias of the same name. `backend-mysql` had the same
problem with no preset to fall back on, so an alias can now declare what to
remove as well as what to add.
