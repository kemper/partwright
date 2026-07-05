---
date: 2026-07-05
branch: claude/confident-carson-gpo63q
files_changed:
  - src/main.ts
  - public/catalog/pomni_articulated.partwright.json
  - public/catalog/pomni_articulated.tile.png
---

## Human

(Continuation of "the quality still isn't lovable — next technique.")
After despeckle shipped, the body pieces remained the weak spot.

## Assistant

The body's residual coarseness was a FRAMING problem, not a tooling
one: the plate-scale seed painted the torso from a frame where it
occupied ~150 px. So instead of building the boundary-subdivision
plumbing next, the existing loop was re-run PER PIECE — each piece
box-selected and rendered filling the whole frame (~7x effective
resolution), Gemini asked to REPAINT CLEANLY (keep the layout, replace
mottle with flat solid fills), projected back with overwrite (top) +
bestFacing (4 obliques), then per-piece despeckle + fill.

That run needed one missing API: `renderSelection({selection, view,
size, showPaint})` — the selection twin of renderIsland. The projection
already accepted `within: {selection}` but nothing could RENDER that
scope framed the way the projector frames it (subset bbox), which was a
UI/API parity gap in the loop for non-island scopes. It returns the
exact view spec to hand back to paintByImageProjection.

Result: every body piece now reads as deliberate flat character paint —
solid torso halves with a crisp seam, opposite-color shoulder puffs,
yellow collar/buttons/trim, clean white gloves, solid leg cuffs.
Catalog entry + tile refreshed (payload ~25.2 MB, still under the
Cloudflare 25 MiB file cap). Caveat recorded honestly: the clean-repaint
pass swapped the torso/puff color sides relative to the prior state —
self-consistent and plausibly harlequin-correct, but it slipped under
the disagreement guard on a scope where yellow/black/hardware pixels
dilute the fraction; per-color-pair disagreement weighting is filed on
#885. Boundary subdivision remains tracked there too.
