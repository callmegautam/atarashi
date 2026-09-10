---
'@atarashi/core': patch
'@atarashi/plugin-kit': patch
---

Keep the whitespace around a slot. Handlebars consumes the newline that ends a
*standalone* partial's line, and every `{{> slot}}` is written as one, so the
blank line a template puts after a slot was swallowed and a file ending in one
lost its trailing newline, both rejected by a generated project's own
formatter. The slot partial now puts that newline back, `injectSlots` ends a
filled `imports` region with a blank line so the region reads as imports rather
than imports-then-code, and the conformance suite rejects a slot written inline,
which is the one shape the fix does not hold for.
