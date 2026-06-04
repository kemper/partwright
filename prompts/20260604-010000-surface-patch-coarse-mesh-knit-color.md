---
date: 2026-06-04
branch: claude/vigilant-einstein-Iifva
pr: 364
touches:
  - src/surface/meshSubdivide.ts
  - src/surface/modifiers.ts
  - src/main.ts
---

## Human

Two regression bugs in the region-selection surface modifier path:

1. **Coarse mesh (e.g. unit cube, 12 tris)**: selecting two faces with fuzzy skin shows no visible
   change, even after the `allBoundary` fix. The whole-model path looks heavily textured but the
   patch path is flat.

2. **Knit texture color loss**: applying knit texture with region selection to a painted model
   (e.g. "Country Manor Estate") strips the colors.

## Assistant

### Bug 1 — coarse mesh patch shows no texture

Root cause: `runOnPatch` runs the modifier with `subdivide: false`, so on a 12-tri cube the patch
has only 4-6 unique vertices. Even with `allBoundary=true` giving full displacement weight, there
are so few vertices that no texture detail is visible. The whole-model path uses
`subdivideToMaxEdge` before displacing, giving ~768 tris at quality=3.

Fix: pre-subdivide the full mesh (not just the patch) before extracting the selected triangles.
Key insight: `subdivideOnce` maps original triangle `t` → children at positions `t*4, t*4+1,
t*4+2, t*4+3` deterministically. After K rounds, original triangle `t` maps to
`[t*4^K, (t+1)*4^K − 1]`. This lets the selection be expanded accurately without tracking
intermediate state.

Added `subdivideWithMask(mesh, opts, selectedTris)` to `meshSubdivide.ts` — identical loop to
`subdivideToMaxEdge` but also expands the selection set through each round. Returns early (0
rounds) when the mesh is already fine enough, and respects the 400K-triangle cap to prevent
explosion on large models.

Updated `runOnPatch` with an optional `preSubdivide` parameter. Each patch function (`applyFuzzyPatch`,
`applyCablePatch`, etc.) now computes a `patchSubdivTarget` using the same formula as the
whole-model path (`Math.max(featureSize/(2*qScale), diag/(200*qScale))`).

Result: cube goes from 12 → 768 triangles before patch displacement is applied; the subdivision
correctly propagates tri-colors so painted meshes still work.

### Bug 2 — knit texture loses color on region selection

Root cause: `applyKnitTexture` in `main.ts` obtained the mesh via `requireCurrentMeshForModifier()`
(returns raw mesh without tri-colors) instead of `meshForModifier(preserve)` (bakes visible
paint into `triColors` when the model is painted). The knit patch result carries
`triColors: base.triColors`, which was null, so `commitSurfaceModifier` skipped color transfer.

All other modifiers (`applyFuzzySkin`, `applyCableKnit`, etc.) correctly use `meshForModifier`
via `buildSurfaceModifier`. The `applyKnitTexture` function was a parallel async implementation
that missed this.

Fix: one-line change — `requireCurrentMeshForModifier()` → `meshForModifier(preserve)`.
