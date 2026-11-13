---
"@atarashi/registry": patch
"atarashi": patch
---

`atarashi new --preset <id> --offline` now falls back to the bundled preset when a registry index is cached but the preset itself is not, instead of failing. `atarashi add --help` no longer lists a `--force` flag that `add` never supported.
