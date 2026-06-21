---
date: 2026-06-09
area: surface modifiers / SDF meshing
---

## Liked
- `model:preview` let me validate the levelSet shell math on an analytic tapered
  frustum headlessly (~2s) *before* touching the real pipeline — confirmed
  `isManifold:true, comps:1` and de-risked the whole rebuild in one call.

## Lacked
- My first hollow PR verified only on straight cylinders/spheres, which happen to
  be the shapes surface-nets handles. The actual subject (a *vase*) is inherently
  tapered — the one shape that broke. Lesson: pick the verification shape from the
  feature's real use case, not the easiest primitive.

## Learned
- The shared SDF→**surface-nets** mesher (`sdfModifier`) emits non-manifold
  geometry on slanted thin walls — `applyVoronoiLamp`/`engrave` share this latent
  bug. `Manifold.levelSet` (marching tetrahedra) is manifold by construction and
  is the right tool for any thin-shell SDF result.
- Debris-shard filtering: marching a kinked trilinear field beads thin SHEET
  shards (near-zero volume, but many tris over a wide flat patch). Triangle-count
  AND bounding-box filters both miss them — the only metric that separates them is
  **|signed volume| per component**, done in Manifold-space (`decompose`/`compose`)
  so it matches `componentCount`.

## Longed for
- A worker path for main-thread levelSet (like `engraveInWorker`) — the ~10–15s
  WASM march freezes the UI with no progress/cancel during the march itself
  (only the field sweep yields). Tracked in #844.
- A lint/CI nudge to verify mesh-baking modifiers on a non-trivial shape (taper /
  organic), not just an axis-aligned primitive.
