---
'@atarashi/core': patch
---

Refuse to write through a symlinked directory in the target. `mkdir -p` and
`rename` both follow a symlink, so a `src -> /etc` planted in the target
redirected `src/index.ts` outside it; the existing path checks only reason
about the string, which looks harmless. Every parent component is now `lstat`-ed
before the move. This matters most for `atarashi add`, which runs inside a
repository the user may have cloned from somewhere they do not control.

Interruption is also reported as its own diagnostic and exits 130, rather than
being indistinguishable from a write failure.
