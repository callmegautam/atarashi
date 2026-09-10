---
'@atarashi/core': minor
---

Run blueprint hooks in a restricted worker thread. A hook gets an empty
environment, no `fetch`, no filesystem or subprocess builtins, no imports from
outside its own blueprint, and a hard timeout; it mutates a structured clone of
what its declared capabilities allow it to see, and only the permitted fields
are copied back. Untrusted blueprints need explicit consent, `--no-hooks` skips
every hook with a warning, and everything a hook returns is re-validated before
it can reach disk.
