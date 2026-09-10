# Security Policy

## Supported versions

| Version | Supported |
|---|---|
| 1.x | ✅ |
| 0.6.x | Security fixes only |

## Reporting a vulnerability

Please **do not** open a public issue. Report privately through
[GitHub Security Advisories](https://github.com/callmegautam/atarashi/security/advisories/new),
or email iamgautamsuthar@gmail.com.

Include the version, reproduction steps, and the impact you observed. Expect an
acknowledgement within 72 hours and an assessment within 7 days.

## Threat model

Atarashi resolves and executes third-party blueprint content, so the security
boundary matters. The guarantees Atarashi makes:

- Blueprint archives are integrity-verified before use.
- Extraction rejects path traversal, symlinks and oversized entries.
- Every written path is confined to the target directory.
- Blueprint hooks run in a restricted worker with capability gating and a timeout.

If you find a way past any of those, that is a vulnerability; please report it.
