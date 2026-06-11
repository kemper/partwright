---
session: "engrave-wallbase-sawtooth"
timestamp: "2026-06-11T19:25:00Z"
model: claude-opus-4-8
---

## Human

Follow-up to the merged engrave/emboss colour fix (#594). Still seeing missed
triangles: a sawtooth of orange (base-mesh colour) notches along the letter wall
bases, the inside ("counter") of the O, and the interior corner of the E. Fix
those without bleeding onto the original mesh. (Three zoomed screenshots
attached.)

## Assistant

### Root cause

`stampTriColors` classified each baked triangle by its **centroid's** distance
off the original surface (`> 1.5·eps`). At a wall base the centroid sits in the
last ~1.5·eps band near the surface, so the triangle was excluded even though its
upper vertices are well up the wall. Because the base triangles are irregular,
the include/exclude boundary zig-zags — the sawtooth. The O counter and E corner
are the same wall-base band on concave walls.

I couldn't simply lower the threshold: the flat surface's surface-nets vertices
already sit up to ~`eps` off the true surface, so anything below ~1.5·eps starts
colouring untouched skin (bleed).

### Fix — classify by the triangle's most-displaced vertex

A wall-base triangle always has at least one vertex up the wall (displacement ≫
threshold) even when its centroid doesn't clear it; an untouched-surface triangle
has *all three* vertices within ~eps. So colouring a triangle when
`max(vertexDisplacement) > 1.5·eps` reaches the rim cleanly without lowering the
threshold — no bleed.

- Refactored `src/surface/colorTransfer.ts`: extracted the spatial hash into
  `buildNearestTriHash(refMesh)` returning a nearest-ref-triangle query for an
  arbitrary point (one implementation now shared by `nearestTriangleMap` and the
  distance helper). Replaced the per-triangle `nearestSurfaceDistance` with
  per-vertex `nearestSurfaceVertexDistance` (length `numVert`).
- `stampTriColors` now takes `max(vdist[v0], vdist[v1], vdist[v2])` per triangle.
  Through-cuts unchanged (still the depth-band test).

### Verification

Re-ran the HELLO-on-a-sphere curved engrave + emboss and cropped into the
letters: the wall-base sawtooth is gone, the O counter ring and E interior corner
are fully coloured, and the colour stops cleanly at the gray surface (no bleed).
Preflight green (typecheck + 1197 unit + acyclic). Unit coverage moved to
`nearestSurfaceVertexDistance` (per-vertex identity ~0, no tessellation floor,
translated-off distance, empty-ref Infinity).
