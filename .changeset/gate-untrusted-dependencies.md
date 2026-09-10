---
'@atarashi/core': minor
---

Hold an untrusted blueprint to the reviewed version manifest. Doc 09 § T3 said a
blueprint "cannot introduce an arbitrary package silently"; in practice the
manifest was only a fallback, so a blueprint that pinned its own range added
whatever it liked: `--add npm:atarashi-blueprint-x` could pull any package at
any version into the user's project. A blueprint the registry did not mark
trusted may now only add dependencies the manifest pins, and gets the reviewed
range rather than the one it asked for. Trusted blueprints may still pin their
own, which the conformance suite reports.
