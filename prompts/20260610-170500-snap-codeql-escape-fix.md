---
session: "e1m4pk"
timestamp: "2026-06-10T17:05:00Z"
sequence: 2
---

## Human

(CI follow-up on PR #573) CodeQL flagged `scripts/snap.mjs`: "Incomplete
string escaping or encoding — does not escape backslash characters" on the
generated test title.

## Assistant

## Key decisions

The generated spec's test title interpolated the route with a quotes-only
escape (`route.replace(/'/g, "\\'")`), so a route containing backslashes or
newlines could break out of the string literal in the generated temp spec.
The `page.goto` interpolation already used `JSON.stringify`; switched the
title to the same (`JSON.stringify(\`snap: ${route}\`)`) for complete
escaping rather than widening the hand-rolled replace. Re-ran
`npm run snap -- /editor` to confirm the helper still passes and cleans up
its temp spec.
