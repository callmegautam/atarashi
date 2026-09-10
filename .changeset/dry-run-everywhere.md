---
'atarashi': minor
---

Add `--dry-run` to every command that changes something. It was on `new` and
`add` only, while `config set`/`unset`, `registry pin`/`unpin`/`clear`/`add`,
`preset save`/`delete` and `eject` all wrote without any way to ask first, which
doc 09 § T6 claimed otherwise. Each now reports the change and makes none, in
both human and `--json` output.
