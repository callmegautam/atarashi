---
'atarashi': minor
'@atarashi/plugin-kit': patch
---

Wire `npm:` blueprint packages through the CLI. `atarashi new --add
npm:atarashi-blueprint-x` and `atarashi add npm:…` now register the package with
the registry and resolve it to the blueprint id its manifest declares; before
this the registry could load such a package but nothing ever asked it to. The
conformance suite no longer holds a blueprint that a package's `atarashi` field
points at to the `<namespace>/<name>` directory convention, which only applies
to blueprints found by scanning a catalogue.
