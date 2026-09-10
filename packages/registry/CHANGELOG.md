# @atarashi/registry

## 1.0.0

### Minor Changes

- ec1979b: Implement the blueprint registry: index fetch with ETag and a 24 h TTL,
  content-addressed cache under the XDG cache dir, root-hash and per-tarball
  integrity verification, hardened in-memory tarball extraction, and the bundled,
  local, npm and remote blueprint loaders behind one `BlueprintSource`. Adds
  version pinning, `--offline`, the deterministic index build script and the
  weekly version-manifest bump.

### Patch Changes

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

- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
- Updated dependencies [ec1979b]
  - @atarashi/core@1.0.0
  - @atarashi/schema@1.0.0
