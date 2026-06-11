---
session: "6sobw6"
timestamp: "2026-06-11T19:45:00Z"
tools: [playwright, vitest]
sequence: 7
---

## Human

After using the in-code surface textures on a real model, three requests
(discussed first, then "I like your three suggestions. Let's do those. Update
the PR with those changes."):

1. Applying a texture to a colored cone (an `api.label(...,{color})` model)
   lost the color.
2. "Whole model" reads as a global call — it should be possible to texture one
   shape of a unioned model (e.g. a knurled cube unioned with a smooth sphere).
3. Region texturing by capturing the XYZ of a viewport click/ray, like paint.

## Assistant

### Color fix (this commit)

**Root cause.** The in-code chain swaps the denser/displaced textured mesh into
`result.mesh` *before* the run handler resolves colors, but `result.labelMap`
(Set<baseTriIndex> per `api.label` name) still indexes the BASE mesh — so
`api.label` / `byLabel` colors land on the wrong triangles (visually: color
lost). The BAKE path already solves the equivalent with
`colorTransfer.nearestTriangleMap` (spatial nearest-centroid carry); the in-code
path simply never used it.

**Fix.** New pure helper `remapTriangleSets(sets, oldMesh, newMesh)` in
`colorTransfer.ts` inverts `nearestTriangleMap` to carry each named base-triangle
set onto the textured mesh (one base triangle → all its children). In
`applySurfaceTextures` (both the cache-hit and freshly-computed branches), when
the run carries a non-empty `labelMap`, remap it onto the textured mesh so the
downstream model-color underlay and `byLabel` paint resolve correctly. Geometric
paint descriptors (box/slab/cylinder) and brush strokes already re-resolve by
shape and need no remap, so only the index-based label sets are touched.

**Verified.** Unit: `remapTriangleSets` (subdivision expands the set, identity on
an unchanged mesh, overlapping labels stay distinct, empty-mesh → empty sets).
Browser: a labeled orange cone keeps its color after `api.surface.fuzzy` — the
`body` label's triangle count tracks 126 → 32256 and `getModelColors` reports the
orange on all textured triangles (screenshot posted in chat).

(Scoping — `label:` and `region:` on surface ops — follows in subsequent commits
on this branch; see the prompt log update / PR description.)
