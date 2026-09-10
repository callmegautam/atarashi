---
'@atarashi/blueprints': patch
'atarashi': patch
---

Close two gaps against doc 09 § T5 and § T7. Generated `.gitignore` files now
carry `.env*` with a `!.env.example` negation, where before only `.env` and
`.env.*.local` were ignored, leaving `.env.local` and `.env.production`
committable, which is exactly the leak that section is about. Both CI blueprints
gained the secret-scanning step the doc promised. And `ATARASHI_TELEMETRY=0` and
`CI=true` now disable telemetry alongside `DO_NOT_TRACK`, as documented.
