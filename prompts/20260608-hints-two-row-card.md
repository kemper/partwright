---
date: 2026-06-08
author: kriskemper@gmail.com
prefix: feat
---

## Human

1. Make the "Did you know?" hints menu more compact: a two-row card where the
   "Did you know?" label, the link/CTA, and the previous/next/close buttons sit
   on the first row, and the actual hint text sits on the second row.
2. Follow-up: keep a single row by default when there's room, and only fall back
   to the two-row layout when the box has to reduce its horizontal size.

## Assistant

Reworked the hints ticker card (`src/ui/hints/hintsTicker.ts`) so it adapts
between two arrangements driven by available width *and* the current hint's
length:

- **Single row (default, when it fits):** icon + "Did you know?" + hint text +
  CTA + ‹ › ✕ controls all inline — the pre-feature layout, with the text on one
  line (`whitespace-nowrap`).
- **Two rows (fallback, when tight):** a compact header (icon + label + CTA,
  controls pushed right with `ml-auto`) and the hint text on its own line below
  (`break-words line-clamp-3`), so the text never competes with the header.

How the switch is decided (`relayout()`): on resize, breakpoint change, and each
text rotation it lays out single-row, measures the intrinsic single-line width
off-flow (`position:absolute; width:max-content`, restored synchronously so it
never paints), and falls back to two rows only when that width exceeds the host.
Because the measurement runs inside the ResizeObserver callback / the rotation's
synchronous task, the transient single-row state is never painted — no flicker.
`setLayout()` reparents the shared elements between a flat strip and a
`topRow + text` column, no-op when the mode is unchanged.

Kept the existing visibility degradation (hide below the md breakpoint or when
the host is under 200px; drop the badge under 360px). No change to rotation,
seen-tracking, CTA dispatch, or session-dismiss. Added an e2e case
(`tests/editor-hints.spec.ts`) that pins the toolbar middle wide vs tight and
asserts the badge and hint text share a row (single) vs stack (two).
