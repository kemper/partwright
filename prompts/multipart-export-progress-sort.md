---
session: "cpf91h"
timestamp: "2026-07-08T19:20:00Z"
model: claude-opus-4-8
---

## Human

Looks pretty good, can we resort the list so that ones being rendered/exported
still are at the top and completed ones below them?

## Assistant

## Key decisions

**Sort the per-part export progress rows by liveness.** In
`exportProgressModal.tsx`, rank rows `rendering (0) → queued (1) → settled
(done/failed, 2)` and sort a copy of the state rows by `(rank, originalIndex)`
in the render. Rendering parts pin to the top, still-queued parts sit below
them, and completed/failed parts sink to the bottom — so the active rows stay in
view on a large (16-part) export.

**Stable within a rank.** Tie-break on the original insertion index so rows
don't churn among same-status siblings, and keep the row `key` as the part id so
Preact moves the existing DOM node (bar + label) rather than rebuilding it —
smooth reordering as a part finishes and drops down.

Verified the DOM order end-to-end in the browser (rendering → queued → done) and
with a screenshot before removing the scratch spec.
