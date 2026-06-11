---
session: "engrave-flatface-speckle"
timestamp: "2026-06-11T20:45:00Z"
model: claude-opus-4-8
---

## Human

The letter coloring is great now, but embossing on a flat cube produces a
speckled color-bleed/distortion across the entire face (regular grid of stray
colored dots). Fix it. (Screenshot attached.)

## Assistant

### Root cause

The regular grid of specks was the tell. `nearestSurfaceVertexDistance` found the
nearest reference triangle **by centroid**, then measured the point-to-triangle
distance to *that one triangle*. On a flat, finely-triangulated densified face, a
query vertex often projects just *outside* the nearest-centroid triangle's
footprint — so the closest point clamps to that triangle's edge and the distance
becomes the in-plane LATERAL gap (up to ~half a ref edge), not ~0. That gap
exceeds the displacement threshold on a periodic subset of vertices → a grid of
spurious "displaced" (colored) triangles. A sphere masked it; the grid-aligned
cube made it obvious.

### Fix

The distance must be the **minimum point-to-triangle distance over the nearby
candidate triangles**, not the distance to the single nearest centroid. Reworked
`buildNearestTriHash` to expose two queries off the one grid:
`nearestIndex` (centroid, for the color transfer) and `surfaceDist2` (min
point-to-triangle over the searched rings, pruning when `(r-2)·cell` exceeds the
best surface distance). `nearestSurfaceVertexDistance` now uses `surfaceDist2`, so
a vertex lying on a flat face reads ~0 regardless of which triangle's centroid is
nearest.

### Verification

Headless cube emboss: flat-face bleed **0** (was a speckled grid), relief still
fully colored. Browser cube render confirms a clean gray face with solid letters.
Added a second case to `tests/unit/engraveColor.test.ts` asserting zero flat-face
bleed on a grid-aligned cube. Preflight green (1225 unit).
