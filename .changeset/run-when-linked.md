---
'atarashi': patch
---

Run when installed. `npm install -g` and `npm link` both put a symlink in the
global bin; Node reports `import.meta.url` as the real file it resolved to and
leaves `process.argv[1]` as the symlink, so the entry-point check, which
compared the two as strings, was never true and the CLI exited 0 having done
nothing. Every test and the whole e2e matrix invoked `node dist/cli.js`
directly, where the two do match, so nothing caught it. The check now compares
what the paths resolve to, and a test invokes the built binary through a symlink.
