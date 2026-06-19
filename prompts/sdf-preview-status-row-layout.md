---
date: 2026-06-19
branch: claude/nifty-hamilton-cjwk3v
files_changed:
  - src/main.ts
---

## Human

(On PR #765's fast-preview pill) The "Fast Preview - Rendering full quality"
message lays overtop of the "Rendering ..." message that has the timer and
cancel button — it should be next to it or below it. Also, post-render the green
"Ready" message is clipped / too-narrow and just shows "R...".

## Assistant

Two layout fixes in the viewport status row, verified in a real browser.

1. The fast-preview pill was an independent overlay at `absolute top-2 left-2
   z-20` — the exact coordinates of the status row (Rendering… + Cancel), so it
   stacked on top. Moved it INTO the status row flex strip (appended next to the
   Cancel button via `cancelInlineBtn.parentElement`) and dropped the absolute
   positioning, so it flows inline: "Rendering… Xs · × Cancel · ⚡ Fast preview".
   Shortened the label to "⚡ Fast preview" (full explanation stays in the title).

2. The "R…" clip was a pre-existing bug surfaced by this feature. `setStatus`
   overwrites the status span's class with `max-w-[60%] truncate` — but the
   status row is an `absolute`, shrink-to-fit container, so a percentage max-width
   resolves against the element's own content-sized parent and collapses to a
   sliver once the Cancel button hides. Replaced `max-w-[60%]` with viewport-
   relative `max-w-[55vw]` (resolves independently of the parent) and restored the
   chip background/border that the className overwrite had also dropped. `truncate`
   still ellipsizes long error messages.

Verified: during preview the three chips sit inline with no overlap; after render
`#status-indicator` shows full "Ready" with `scrollWidth === clientWidth` (not
clipped).
