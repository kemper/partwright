---
date: 2026-06-09
author: claude (opus-4-8)
area: surface modifiers / wireframe edge cage
---

## Human

Add a "Wireframe / edge cage" volumetric surface modifier: keep only the model's
sharp feature edges as smooth round struts (a see-through cage). Explicitly **not**
via `sdfModifierMesh`'s surface distance `d` — it needs distance to the model's
EDGES, so build a bespoke scalar field and mesh it with the lower-level pieces the
foundation exposes (`surfaceNetsField`, `largestMeshComponent`, `smoothSurface`),
copying `sdfModifier.ts`'s grid/padding/rasterize-for-bounds recipe. Wire it like
the Voronoi lamp across `modifiers.ts` / `surfaceModal.ts` / `tools.ts` / docs,
honor UI↔JS API parity, verify in-browser, add a golden-path spec + unit tests.

## Assistant

New field module `src/surface/wireframeField.ts`:

- `extractFeatureEdges(mesh, angleThresholdDeg)` — welds coincident vertices (so
  shared edges are detected on unwelded meshes), gathers the faces touching each
  undirected edge, and keeps an edge as a "feature" when it's a boundary /
  non-manifold edge **or** its two faces bend past the threshold
  (`dot(n0,n1) < cos(angle)`). For a cube: the 12 box edges qualify (90° creases),
  the 6 coplanar face diagonals don't.
- `wireframeMesh(mesh, opts)` — `field(p) = distToNearestFeatureEdge(p) − strutRadius`,
  meshed at iso 0. Reuses `rasterizeSolid` only for the bbox-derived grid + voxel
  size, pads the lattice by `strutRadius`, then **splats each segment in a narrow
  band** (only lattice points within the strut radius are touched, so cost scales
  with edge length, not grid volume). The iso-0 surface of an unsigned
  distance-to-segments field is exactly the union of round capsules → cylindrical
  struts with rounded corner joins for free. Then `largestMeshComponent` +
  `smoothSurface`. Resolution auto-raises so the strut diameter spans ≥5 cells.

Wiring mirrors the Voronoi lamp (the stated template, also a whole-model-only,
mesh-baking volumetric op): `applyWireframe` + `defaultWireframeOptions` in
`modifiers.ts` (`ofMesh` wrapper + a clear throw when no edges qualify), a
`wireframe` tab in `surfaceModal.ts` (strut radius / edge-angle / resolution /
watertight + command palette), the `buildSurfaceModifier` branch + public
`applyWireframe` method in `main.ts`, the `tools.ts` schema/dispatch/`SAVE_GATED`
entry, and `public/ai/textures.md` + `public/ai.md`. (Surface modifiers aren't in
the `help()` methods table — none of the family is — so I matched that precedent
and documented in textures.md, the family's real discoverability surface.)

Fixed a latent gating bug uncovered by the UI test: the region-less tabs
(voxelize / voronoi lamp / wireframe) hide the region selector but `regionMode`
still defaulted to `'region'`, so `regionBlocked()` left **Apply disabled** on
those tabs. Hoisted the set of region-less tabs into `REGIONLESS_TABS`, made
`regionBlocked()` return false for them, and refreshed the Apply/Preview buttons
in `renderTab()` on tab switch. This also un-breaks the Voronoi-lamp / Voxelize UI
Apply paths.

Verified in-browser: a 24³ cube → clean edge cage, `isManifold: true`,
`componentCount: 1`, `genus: 5` (correct for a cube frame), volume ~1050 vs
~13824 solid. Unit tests cover edge extraction (count, threshold cutoff, corner
endpoints) and the meshed cage (hollow volume, extent, empty on no-edges). E2E
golden path in `tests/surface-wireframe.spec.ts`.
