---
'@atarashi/registry': minor
---

Implement the blueprint registry: index fetch with ETag and a 24 h TTL,
content-addressed cache under the XDG cache dir, root-hash and per-tarball
integrity verification, hardened in-memory tarball extraction, and the bundled,
local, npm and remote blueprint loaders behind one `BlueprintSource`. Adds
version pinning, `--offline`, the deterministic index build script and the
weekly version-manifest bump.
