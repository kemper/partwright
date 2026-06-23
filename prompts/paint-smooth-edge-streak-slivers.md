---
session: "pxo3mn"
timestamp: "2026-06-21T20:00:00Z"
---

## Human

"On occasion when I paint with smoothed edges I see a triangle aberration. It's
not consistent but here is a screenshot of what it looks like." Screenshot: a
painted blob on a tessellated cone with thin razor-like "streaks" radiating
downward from the painted region, aligned with the cone's vertical mesh edges.
Follow-up: "Noticed the downward streaks close to the center."

## Assistant

## Key decisions

**Root cause: the boundary-conforming clip emitted degenerate slivers when the
paint outline grazed a triangle corner.** `clipByField` (src/color/subdivide.ts)
splits every triangle the `field = 0` contour crosses into three sub-triangles
along the crossing. When the contour grazes a corner — both edge crossings from
one vertex land near it — the `(P1, C, Q)` sub-triangle becomes a long,
razor-thin sliver spanning the whole triangle. The old `1e-6` parameter clamp
was meant to prevent zero-area slivers but did the opposite: it *kept* the thin
wedge instead of collapsing it.

**Why the streaks are long and aligned with mesh edges.** `selectByClassify`
skips refining a straddling triangle when the field is "provably straight" across
it (a straight painted edge needs no curve refinement). So a straight outline
grazing a *coarse, un-refined* triangle goes straight to the clip and emits a
full-triangle-length sliver. Where the outline runs nearly parallel to a chain of
mesh edges (the cone's vertical radial edges), each grazed triangle contributes
one sliver → a vertical "downward streak." Intermittent because it needs the
outline to graze near a vertex.

**Fix (clip robustness, crack-free).** In `clipByField`:
1. `crossOf` now *snaps* a crossing that lands within `CLIP_SNAP_EPS` (1% of an
   edge) onto the existing endpoint vertex instead of minting a near-coincident
   one. The snap is a pure function of the shared (undirected) edge, so both
   triangles across it snap identically — no T-junction / crack.
2. A new `emitClip` drops any sub-triangle snapping has collapsed to a point
   (coincident indices) or a line (collinear vertices). These carry zero surface
   area, so dropping them removes no coverage; the sibling sub-triangles already
   tile the parent's real area.

**Verification.** Headless geometry repro (build a coarse grid + a square outline
grazing a grid column): long thin slivers went **72 → 0**, worst-triangle extent
2.83 → 0.088 (sub-cell, invisible). Added a regression test in
`tests/unit/subdivide.test.ts`. Full unit tier (1588 tests) green, typecheck
clean, `lint:deps` acyclic. Browser check: painted a grazing squiggle on a
tessellated cone via `partwright.paintStroke` — the painted edge renders smooth
with no streaks.
