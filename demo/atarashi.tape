# The README demo, as a VHS tape. This file is the source of truth; the GIF is
# a build artefact. Produce it with:
#
#   vhs demo/atarashi.tape
#
# See demo/README.md for prerequisites and how the recording is kept honest.

Output demo/atarashi.gif

Set Shell bash
Set FontSize 16
Set Width 1200
Set Height 760
Set Padding 20
Set Theme "Catppuccin Mocha"
Set TypingSpeed 45ms
Set PlaybackSpeed 1.0

# A clean room, so the recording never leaks the operator's own config or cache.
Hide
Type "export ATARASHI_CONFIG_DIR=$(mktemp -d) PS1='$ ' && cd $(mktemp -d) && clear"
Enter
Show

Sleep 800ms

# ── 1. Compose a project out of capabilities, not a template name ────────────
# --no-install is on screen rather than hidden in the clean room: installing is
# the default, it takes half a minute, and a viewer copying the line should get
# what they watched. Generation itself is the part worth showing, and it is ~1s.
Type "atarashi new my-api --http fastify --db postgres --orm drizzle --auth jwt --yes --no-install"
Sleep 700ms
Enter
Sleep 4s

Type "cd my-api && ls"
Sleep 400ms
Enter
Sleep 2s

# ── 2. The decisions are recorded, which is what makes the next step possible ─
Type "cat atarashi.json | head -20"
Sleep 400ms
Enter
Sleep 3s

Type "clear"
Enter
Sleep 400ms

# ── 3. Add a capability to the project that already exists ───────────────────
Type "atarashi add obs/pino --yes --no-install"
Sleep 700ms
Enter
Sleep 3s

Type "git diff --stat"
Sleep 400ms
Enter
Sleep 2500ms

Type "clear"
Enter
Sleep 400ms

# ── 4. It refuses what cannot work, and says what to do instead ──────────────
Type "atarashi new other --add orm/drizzle --yes --dry-run"
Sleep 700ms
Enter
Sleep 4s

Sleep 2s
