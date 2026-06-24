---
date: 2026-06-09
author: claude (opus-4-8)
area: surface modifiers / hollow (vase + mask)
---

## Human

"I just don't really see how this works. I want to use it with 3d printing. I
could see this being like an 'auto vase mode' but it would have to cut the top
off and let the inside be hollow. alternatively I could see cutting a model in
half and doing a shell-mode operation so it could be a mask. This does neither
from what I can tell. What do you think?"

Then, after I confirmed the defect and laid out options: **"Rebuild robust +
cut-plane (both cases)."**

## Assistant

**The defect (real).** I'd verified the first hollow PR on straight cylinders and
spheres, which work — but a *tapered* vase (the normal case) failed: the shared
SDF→**surface-nets** mesher emits non-manifold geometry on a slanted thin wall, so
`Manifold.ofMesh` rejected it ("Not manifold") and the thin cut rim rounded shut.
Confirmed `applyVoronoiLamp` fails identically on the same frustum, so it's a
property of the shared dual-contour mesher, not the combine.

**The fix — mesh the field with `Manifold.levelSet`.** levelSet (marching
tetrahedra) is watertight/manifold *by construction*, so a tapered vase comes out
one clean piece. Prototyped the math headlessly first (`model:preview` on an
analytic frustum shell → `isManifold:true, comps:1`) before touching the pipeline.

Pipeline:
- Refactored `sdfModifier` to expose `buildSignedDistanceField` (the BVH distance
  sweep) — reused by the surface-nets path (apply a combine + mesh) and the new
  levelSet path (trilinearly sample it). `sdfModifierMesh`'s output is unchanged,
  so voronoiLamp/engrave are untouched (verified: their spec still green).
- `hollowShell.ts` now: build the d-field → materialize the hollow SDF on the grid
  (wall band `max(d, -(d+wall))`, opened along a plane, minus drain cylinders) →
  `keepLargestFaceConnected` to drop fragments → `Manifold.levelSet` over a
  trilerp of the cleaned field → drop debris.
- **Debris saga (3 metrics).** Marching the kinked trilerp field beads ~20
  sub-voxel shards off the wall. Triangle-count and bounding-box filters both
  missed them (the shards are thin SHEETS — many ~zero-area tris over a wide flat
  patch). The metric that works is **|signed volume| per component**; I do it in
  Manifold-space (`decompose` → keep ≥2% of the largest by |volume| → `compose`)
  so it matches how `componentCount` is computed. Closed shell → 2 (outer+inner),
  open vase/mask → 1, no debris.

**Generalized `openTop` → a cut plane** (`open: {axis, offset, side}`), which is
the same op for both cases: vase = a +Z plane near the top; mask = any axis-aligned
plane, keep one side as an open shell. The Surface panel got a **Mode** selector
(Open-top vase / Cut-plane mask / Sealed shell), defaulting to vase, with the
mask axis/position/side controls. API + AI tool + docs carry the `open` plane.

**Verified on the tapered shape** (the bug case): closed → manifold, comps 2,
⅓ volume; vase → comps 1, open vessel; mask (sphere cut + shelled) → comps 1,
concave shell; planter → comps 1 with 5 drains. ~10–15s per op (a heavy levelSet
march — like the sibling SDF modifiers; worker-izing it is a tracked follow-up,
issue #844). `build` + `test:unit` (1590) green; new e2e asserts manifold +
component counts on the frustum; unit tests cover `buildSignedDistanceField` and
`dropTinyMeshComponents`.
