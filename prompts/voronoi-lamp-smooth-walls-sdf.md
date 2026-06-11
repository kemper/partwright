---
date: 2026-06-09
author: claude (opus-4-8)
area: surface modifiers / voronoi lamp
---

## Human

"I recently merged a voronoi surface feature. However, it still looks kind of
angular and rough to me. I tried turning up the resolution but that didn't seem
to help. Investigate and propose ideas."

Then, after investigation: "Do both A and B" (A = smoother mesher, B = raise the
resolution cap + a text entry that allows typing a larger max than the slider),
and after I found A couldn't fix the real cause: "Rebuild on SDF/levelSet (the
real fix)."

## Assistant

**Diagnosis.** The merged feature is the Voronoi *lamp* (perforated shell). Its
default mesh output meshed a **binary voxel occupancy** shell, so curved walls
came out with vertical "corduroy" stair-stepping. I confirmed this is intrinsic
to the voxel pipeline — the app's own smooth-voxelize shows the same corduroy on
a plain cylinder — and that neither resolution (the grid was capped at 200, and
at fixed zoom finer just means more stripes) nor Taubin smoothing (tested to 15
iterations) removes it. That's exactly why "turning up resolution didn't help."

**Why not Surface Nets (the first idea).** Swapping the blocky mesher for Surface
Nets rounds the struts but keeps the corduroy (it still meshes binary occupancy),
and it breaks the single-piece guarantee on thin walls. So it doesn't address the
actual complaint.

**The fix — mesh a continuous signed-distance field.** Corduroy disappears only
when the surface is found *sub-voxel* from a continuous field (the principle
behind `Manifold.levelSet`). Surface modifiers run pure-JS on the main thread
with no WASM, and a dense field grid can't be shipped to the worker's levelSet,
so I built the equivalent in pure JS:

- `surfaceNetsField.ts` — Surface Nets generalized to interpolate each cube
  edge's zero-crossing from a continuous field (vs. the voxel mesher's fixed
  midpoints). Unit-tested: a sphere field meshes to a closed, edge-manifold
  surface at near-true radius.
- `voronoiLampSdf.ts` — builds `lamp(p) = max(shell, strut)`:
  - `shell` = within `wallThickness` inside the original surface, where the
    distance is the **true** distance to the smooth mesh (BVH closest-point via
    `three-mesh-bvh`, already a dep). Critically, the distance is **signed by the
    closest face's normal**, not by voxel occupancy — mixing a true magnitude
    with a stair-stepped occupancy sign snaps crossings back onto the voxel steps
    (the bug that first kept the corduroy).
  - `strut` = the analytic `cellEdgeDist3D` Worley field (smooth window cuts).
  - The Worley field is only evaluated inside the wall band (huge speedup), and
    distances only in a narrow band around the surface.
- Connectivity, the voxel path's way: `keepLargestFaceConnected` keeps the
  largest 6-connected region of inside samples *before* meshing (drops detached
  fragments without sealing windows the way growing the iso level does), then a
  mesh-level edge-connected `largestMeshComponent` and a few light Taubin passes
  clean the rims.

**B (kept and now genuinely useful).** Resolution slider gets a numeric text box
(`sliderWithEntry`) that accepts values beyond the slider max; the cap rose 200
→ 256 (the SDF field's memory-bound ceiling), unified across the modal, the voxel
path, and the AI tool schema. With the continuous field, resolution actually
sharpens the result instead of just adding finer stripes.

**Result / trade-offs.** Walls are smooth on spheres and cylinders, windows stay
open, the web is one physically face-connected piece, and it's manifold. Costs:
heavier op (~10s; it's a one-shot bake) and a few mesh-level islands joined at
points (so `componentCount` can read >1 even though it prints as one piece — same
caveat the docs already note for voxel models). Voxel output is unchanged.

Verified with build + unit (incl. new field/component tests) + the e2e voronoi
suite, and eyes-on renders of sphere/cylinder lamps before and after.
