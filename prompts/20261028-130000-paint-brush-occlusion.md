---
session: "fe6e04b5"
timestamp: "2026-10-28T13:00:00Z"
sequence: 3
---

## Human

"there are conflicts, fix, merge the PR, then do the occlusion follow-up from
#1174"

(#1174's remaining item: in View mode the smooth brush paints every
front-facing surface within `depth` along the ray, including one hidden behind
visible geometry, e.g. a cheek just behind a nose, inside the brush.)

## Assistant

## Key decisions

**Deterministic CPU occlusion, not the depth buffer.** The smooth brush's
footprint is re-resolved from the stored descriptor on every rebuild, on the
main thread and in the subdivision Worker, so it can't depend on what was on
screen. A stroke that stores `occlude: true` (plus its camera `view`) casts a
ray from each candidate triangle's centroid toward the camera position (or
against the view direction for parallel rays) through a three-mesh-bvh BVH of
the pristine base mesh; a hit means the triangle is hidden and stays
unpainted. The BVH copies the index (`indirect: true`) so it never reorders the
shared base mesh, and is cached per base mesh.

**Applied last in the footprint resolve** — only to triangles already inside
the footprint — so its cost scales with the painted area, not the mesh. Not
applied in the refine classifier: centroid occlusion is approximate for coarse
triangles, so hidden areas may still be refined (cost only, no wrong paint).

**One UI toggle.** "Front faces only" becomes "Visible faces only" = facing
test + occlusion (Blender texture paint's Cull + Occlude, both on by default).
Occlusion doesn't depend on winding, so it stays on when the facing test is
skipped for an inverted-winding mesh. API/AI: `occlude` on paintStroke /
paintAirbrush through the shared option parser; `setBrushFrontFacesOnly`
drives the combined toggle.

**Out of scope:** `tests/unit/toolGroups.test.ts` fails on main (three new AI
tools — listExportItems, partAction, undoPartEdit — aren't in a tool group).
Not this change's code; noted on the PR with a proposed patch rather than
widening it.
