---
date: 2026-06-07
branch: claude/admiring-einstein-kQLx7
files_changed:
  - src/surface/placement.ts
  - tests/unit/placement.test.ts
---

## Human

I recently merged a rotate-in-place set of functionality in the UI, with a
"lay flat" function. But I feel like it's just grabbing whatever the nearest
flat surface of an object is. What I really wanted is to find the side of an
object with the *largest* flat surface — like a coin should rest on its broad
face, not its rim; a book on its cover where you get the most square millimeters
of contact. Investigate and report what fixes/improvements we could do.

Scope chosen: the focused "largest flat face" fix (cluster contiguous coplanar
triangles, pick the largest true face). Not the heavier convex-hull/centre-of-
mass stability version.

## Assistant

Investigated `bestFlatDownRotation` (`src/surface/placement.ts`), the only
lay-flat implementation, wired to the Place/Rotate panel's "Lay flat" button.
The rotation math (shortest-arc normal→−Z, Euler extraction) was correct; the
flaw was purely in *face selection*. The old code bucketed every triangle by its
quantized normal *direction* (`round(n*100)`) and laid the largest-area bucket
down. Two failure modes:

1. **Buckets by direction, not plane.** Faces pointing the same way at different
   heights (stair steps, embossed text, scattered ledges) were summed into one
   phantom "face", so the part could be tipped onto a small protrusion whose
   pooled area beat the real largest face.
2. **Hard quantization degenerates on organic meshes.** For a coin/book — one
   shared normal per flat face — it happened to work. But for any curved,
   smoothed, voxelized, or photo-derived model, no two triangles share a normal,
   so each bucket holds ~1 triangle and "largest bucket" collapses to "biggest
   single triangle" — an arbitrary facet. That's exactly the "grabs whatever
   flat-ish surface is nearby" behaviour reported.

**Fix:** region-grow contiguous coplanar triangles into real faces, then pick
the largest by total area.
- Weld vertices by quantized position (scaled to the model diagonal) so adjacency
  survives meshes that duplicate vertices per triangle (imported STL / some
  bakes); a no-op for manifold's own shared-index meshes.
- Build triangle adjacency over shared welded edges.
- BFS-grow each region, **seeded from the largest triangles first** and comparing
  every candidate to the region's *seed* normal (not just its neighbour, dot >
  0.999). Seed-relative comparison bounds drift, so a curved surface grows into
  thin near-flat bands instead of swallowing the whole mesh (and never produces a
  whole-rim component whose area-weighted normal cancels to zero).
- Largest region's area-weighted normal → `rotationFromTo(n, [0,0,-1])`. The two
  hardcoded tolerances live as named module consts (`COPLANAR_DOT`,
  `WELD_FRACTION`) — structural geometric epsilons in the spirit of the other
  inline epsilons already in this pure unit-tier module, not user-tunable knobs.

Deliberately does **not** pool non-coplanar same-direction faces — the part rests
on one contact plane, so inventing a face from scattered area would be wrong.
(Convex-hull resting-face enumeration + centre-of-mass stability is the heavier
follow-up the user declined for now.)

**Tests** (`tests/unit/placement.test.ts`): added closed-mesh builders
(`solidBox`, faceted `disk`, `mergeMeshes`) and three cases — coin stood on its
rim lands on its broad face (height = thickness), a book stood on its spine lands
on its largest face, and a part with two stacked +Z ledges (pooled area 158)
beside one tall wall (single face 90) lays on the wall's side, proving
non-coplanar faces are no longer summed. The original tilted-slab + degenerate
tests still pass. 21/21 in the file, 784/784 unit tier, build clean.

**Browser check:** drove a cylinder (`Manifold.cylinder(...).rotate([90,0,0])`,
standing on its rim) through `partwright.layFlatModel()` — it rotated onto its
broad face, resting on Z=0 with bbox `[36,36,3]` (height = the 3-unit thickness).
Posted before/after screenshots.
