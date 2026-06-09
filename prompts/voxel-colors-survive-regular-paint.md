---
session: "01TLwb"
timestamp: "2026-06-08T15:55:00Z"
---

## Human

When using the regular (mesh) Paint tool on an imported voxel tile, the voxel
colourisation disappears — but reopening Voxel Studio brings the colours back.
The user wants the voxel colours kept all the time, even after a regular paint
operation. (Asked to investigate and recommend among: keep colours / warn it
converts to mesh / disable paint on voxel sessions.) Chose **keep the colours**.

## Assistant

## Key decisions

**Root cause: paint's colour compositing blanks everything it didn't paint.**
`buildTriColors` (regions.ts) allocates a fresh all-zero buffer and a `_painted`
sidecar that's `1` only on user-painted triangles, then hands it to the viewport.
The renderer shows the default shade wherever `_painted[t] === 0`, so every
triangle the user didn't paint loses the voxel mesh's per-triangle colour.
Reopening Voxel Studio re-runs the code, regenerating the mesh with full voxel
colours — which is why the colours "came back". This would hit any pre-coloured
import (coloured STL, relief), not just voxels.

**Fix part 1 — seed the composite from the base mesh's own colours.** Added an
optional `baseColors` arg to `buildTriColors`; when present it pre-seeds the
buffer (and marks those triangles painted) before the region layers composite on
top. `applyTriColors` (export) and `applyTriColorsIfVisible` (viewport) now pass
`mesh.triColors`. Plain manifold sessions have no `triColors`, so they're
unaffected — verified the "no base colours" path keeps the prior behaviour.

**Fix part 2 — carry colours through paint's mesh subdivision.** The smooth
brush subdivides the rim triangles, and the subdivision built new meshes without
`triColors`, so colours would still vanish there. Added `propagateTriColors` in
subdivide.ts and applied it at the two refine chokepoints (`buildRefinedMesh`,
`buildRefinedMeshFromSet`) so each child triangle inherits its parent's colour
and painted flag via the already-computed `childToParent` map. Both paint paths
(`refineMeshForRegions` full rebuild and `buildStrokeMesh` incremental append)
route through these, so colours survive every brush.

**Scope.** Left the analysis-only `buildTriColors` callers (bucket seed match,
surface modal, optical preview) unchanged — they want the region-only composite.
Did not add a convert-to-mesh warning or disable paint on voxel sessions; the
user picked "keep the colours", and the seed fix makes regular paint additive
over the voxel colours, which is the least-surprising behaviour.

**Verification.** Reproduced end-to-end: painted a two-colour voxel slab with
the regular Paint tool and confirmed the green/orange voxel colours survive
(previously the model reverted to default blue except the painted patch). Added
unit tests for the seeding (base colour preserved on unpainted tris; plain mesh
unchanged). Full unit tier (802) + paint/voxel/smooth-brush e2e pass.
