---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_expectant_mother.js
---

## Human

I like the idea of the two separate helpers. Build those helpers and use
nipples, brows, and belly buttons (or mouths) as a test/experiment of how they
are working. Produce several preview images with multiple angles for me to
judge the quality.

## Assistant

Built the two engine helpers (issue #738) and migrated three features as the
experiment:

- `surfaceMarking(surface, region, relief, soften)` — a PROUD, paintable marking:
  `surface.round(relief).smoothIntersect(region, soften)`. The areola recipe
  generalized — conformal offset of the real surface, soft-clipped, label + union
  at top level. Stands proud so the label owns its triangles (a coincident
  marking dithers).
- `surfaceRecess(body, cutter, soften)` — a carve (`smoothSubtract`). Kept
  separate because the mechanism differs: a marking is added (union) and carries
  a label; a recess is removed (subtract) and — being a void — can't (colour
  rides positive unioned nodes), so a painted recess must pair it with a marking
  shell inside (documented).

Migrations: nipples → `surfaceMarking` (identical output, now via the helper);
navel → `surfaceRecess`; brows → `surfaceMarking` + a new `on:` surface param so
the brow is a thin proud strip of the ACTUAL forehead instead of a sagitta-guess
capsule that floats/sinks. `assembleFace` passes `on: result`; top-level painted
brows pass `on: skin` (updated `expectant_mother`). Legacy sunk-strip kept as the
no-`on` fallback.

Verified: typecheck clean, 240 figure unit tests pass, all three figures build
componentCount=1 with labels resolving. Rendered multi-angle previews (brows
colored face; swimmer nipples+navel colored front + profile) for the user to
judge before opening the PR. Caveat noted: the brow's scoping arc is still
coarsely positioned by the existing path (incl. sagDrop), but no longer DEFINES
the surface — fully removing sagDrop (a depth-robust forward-curtain region) is a
clean follow-up.
