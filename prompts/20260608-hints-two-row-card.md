---
date: 2026-06-08
author: kriskemper@gmail.com
prefix: feat
---

## Human

Make the "Did you know?" hints menu more compact: a two-row card where the
"Did you know?" label, the link/CTA, and the previous/next/close buttons sit
on the first row, and the actual hint text sits on the second row.

## Assistant

Restructured the hints ticker card (`src/ui/hints/hintsTicker.ts`) from a
single horizontal flex row into a vertical `flex flex-col` card with two rows:

- **Why two rows:** the old single row forced the hint text to compete with the
  badge/CTA/controls for horizontal space, so when room got tight (e.g. AI panel
  open) the text wrapped to up to three lines and the whole strip ballooned
  wide. Stacking the header above the text keeps the header compact and lets the
  text wrap beneath without pushing the controls around.
- **Row 1 (header):** icon + "Did you know?" badge + CTA grouped on the left;
  the ‹ › ✕ controls pushed to the right edge with `ml-auto` (kept their divider
  so they still read as the hints' own controls).
- **Row 2:** the rotating hint text (`#editor-hints-text`), unchanged classes
  (`break-words line-clamp-3`) so the existing wrap/clamp behavior carries over.

Left the responsive `applyWidth` logic untouched — it still drops the badge as
the host narrows and hides the whole card when there's genuinely no room. No
behavior change to rotation, seen-tracking, CTA dispatch, or the session-dismiss
flow, so the existing e2e spec (`tests/editor-hints.spec.ts`) passes as-is.
