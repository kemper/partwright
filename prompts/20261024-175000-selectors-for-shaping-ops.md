---
session: "01CXxFpQDo4c2MfrSHT7paFF"
timestamp: "2026-10-24T17:50:00Z"
sequence: 2
---

## Human

Agreed with two ideas from the mesh-editing ideation right away: one
serializable selector shared by every shaping operation, and editable parts
(e.g. "make the head bigger" on an uploaded STL) without manual sculpting.
Tracked in #1093.

## Assistant

## Key decisions

**One selector, plain data** (`src/geometry/selector.ts`): `{label}` |
`{region:{center,radius}}` | `{where:{facing,tolerance,min,max,box}}`. Keys AND,
arrays OR, `except` subtracts. It is data, not a callback, so it lives in model
code and survives edits that move triangles. Labels resolve against the run's
own label registry (published per run by the manifold-js sandbox), so
`api.label` parts and detected import parts (`api.importWithParts`) work the
same way.

**Triangle-first resolution, then vertex weights**: a face is in when its
label run, centroid and normal match. Its vertices get weight 1, and `blend`
feathers the weight outward with a smooth falloff (grid-hashed nearest
selected vertex). The ops wrap their existing warp functions with
`weightedWarp`, so every op gains `select` and `blend` without being rewritten.

**`sculpt.transform` as the "editable parts" first step**: a soft-selection
move/scale/rotate (Blender's proportional editing) covers "bigger head / raise
the arm" without cutting and re-welding the mesh. Labels and paint survive
because it is a warp, not a remesh. The extract-transform-reattach
`api.editPart` from #1093 stays a later deliverable for edits a warp can't do.

**Scoped deforms measure the selection, not the shape**: twist / taper / bend
use the selection's own bounds, and twist turns about the selection's own centre
line, so one arm twists about itself.

**Loud failures**: an unknown part or an empty match throws, listing the
known parts. A selector that silently does nothing is the failure mode
part-scoped paint had to fix.

**Bug found by headless bisection**: the combined model produced
negative-volume slivers. warp passes doubles but getMesh exports Float32, so the
decimal-grid position key missed some selected vertices. Keying on
`Math.fround` fixed it; a unit test pins it.

**Out of scope for this PR (tracked in #1093)**: `round` / `smoothWeld` region
scoping (lattice-based), label carry-through on remeshing ops, `api.editPart`,
and `diffVersions`.
