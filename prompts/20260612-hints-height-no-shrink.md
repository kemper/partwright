---
date: 2026-06-12
author: kriskemper@gmail.com
prefix: fix
---

## Human

The "Did you know?" box was changing the height of the interactive view,
giving the page a stutter feeling. If the box increases in size for any
reason, it should no longer decrease so it doesn't change the height/position
of the panes below it.

## Assistant

Root cause: the hints card (`src/ui/hints/hintsTicker.ts`) flips between a
single-row and a two-row arrangement, and in two-row mode the text wraps across
1–3 lines (`line-clamp-3`). Each of those is a different height, and the card is
the tallest child in the flex toolbar, so its height *is* the toolbar height.
When a rotation or a width change shrank the card back down, the toolbar
shrank with it and every pane below jumped up — the "stutter."

Fix: a height high-water mark. `lockMinHeight()` runs at the end of `relayout()`
(so it covers resize, breakpoint change, and each text rotation), reads the
strip's `offsetHeight`, keeps a running max in `maxStripHeight`, and pins it back
as an inline `min-height`. Because `offsetHeight` already includes any
`min-height` we've set, the measured value is monotonic: it only ever reflects
genuine growth, and a shorter hint or the single-row layout keeps the taller
height instead of snapping the panes around. The running max resets to 0 in
`renderStrip()` so a fresh mount (toggle off/on, new session) starts at its
natural height.

This intentionally does not touch the single-vs-two-row *decision* (still
width-driven via `measureSingleNeeded()`); it only prevents the card from ever
shrinking once it has grown, exactly as asked.

Verified in the browser by forcing the toolbar middle narrow (card grows to the
taller two-row layout) then wide again (would normally snap short) and
confirming the card — and the session bar / viewport below it — held their
position. Added a regression case to `tests/editor-hints.spec.ts` asserting the
strip height does not decrease after going narrow→wide.
