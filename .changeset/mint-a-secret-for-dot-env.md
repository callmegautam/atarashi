---
'@atarashi/schema': minor
'@atarashi/core': minor
---

Let an env entry declare `generate` (`hex-32`, `hex-64` or `base64url-32`),
which fills `.env` (never the committed `.env.example`) with a fresh random
value. A required signing key was correctly blank in the example and therefore
blank in `.env` too, which stopped a generated project on its own env
validation. This is the one part of a generation that is deliberately not
reproducible run to run.
