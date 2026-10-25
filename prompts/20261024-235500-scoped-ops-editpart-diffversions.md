---
session: "01CXxFpQDo4c2MfrSHT7paFF"
timestamp: "2026-10-24T23:55:00Z"
sequence: 4
---

## Human

"Do them all in one PR": the three remaining deliverables of the AI-drivable
mesh-editing tracking issue (#1093) — 1b (region-scoped round / smoothWeld,
surface scopes on the shared selector), 3 (`api.editPart`) and 4
(`diffVersions` edit-locality check).

## Assistant

## Key decisions

**Scoped round / smoothWeld splice an exact edit into the untouched input.**
Mixing a whole-model raster remesh with a weight softened every edge (the
whole model was remeshed). Instead the op runs on a fine local lattice over the
selection, the edit is cut to the zone where it actually moves the surface,
and that zone is unioned into the input with it removed — so everything the op
leaves alone (sharp edges, tessellation, labels) is bit-for-bit the input.

**Exact distances, not raster morphology, for the scoped path.** The raster
open/close shifts a flat face by a lattice-dependent sub-voxel amount, which
showed as a step at the splice. Exact point-to-triangle distances near the
surface, with each morphological step measured to a dense sampling of the
previous iso-surface (lattice crossings + a k-d tree), keep untouched faces in
place; intermediate levelSets were too slow (148 s → 46 s worst case, a few
seconds for local selections).

**Boolean robustness was the long pole.** Coincident surfaces shatter booleans
into slivers: the remesh is lifted 0.05 voxel, the input is cut over a slightly
smaller zone than the remesh covers (no shared cut faces), and zero-volume or
tiny inside-out shells are dropped after a re-merge.

**`api.editPart` cuts at the bisector between the part's faces and the rest.**
A head comes off at the neck, an arm at the shoulder, for any selector (labels
or detected import parts). The default pivot is the seam's centre so scaling
keeps the part attached and rotation turns at the joint; `blend` fillets the
seam with the scoped weld. Lattice noise near the bisector is flood-filled
away, voxel-sized crumbs are dropped, and cavities the edit seals at a curved
seam are filled (a hollow model's own cavities are kept).

**`diffVersions` gained `{ geometry, render }` rather than a new method.** It
re-runs both versions and measures each surface against the other at
area-spread samples (corners alone misjudge long triangles), reporting per-part
`changedFraction` so a neighbour that only shares the seam reads as a small
fraction rather than "changed".

**Surface `select` reuses the selector.** `label` / `region` stay as
shorthands; labels resolve main-side through a triangle-index lookup on the
run's labelMap.

**Follow-up filed:** the sub-voxel seam hairline in the edge overlay is #1112; a retro note records the boolean-robustness lessons.

**Review follow-up.** The review agent found:
- `editPart` crashed on a whole-model selection;
- it silently dropped small separate components and filled a scaled hollow part's own cavity;
- the plain-union seam left tiny handles;
- a scoped round could hide an "everything eroded" case behind NaNs;
- `diffVersions` re-runs ignored companion files and saved textures, and left a BREP version's shape in the Worker.

Fixes:
- crumb and cavity cleanup now only drops pieces neither operand had;
- the cut field is blurred before the cut is built;
- the default seam fillet is 1/32 of the cut box, so it doesn't shrink as the cut resolution goes up;
- `resolution` is capped at 128;
- `diffVersions` passes companion files, measures saved textured meshes, and re-runs the live BREP code afterwards.

The remaining notes went into the docs: the `select` texture border is approximate, and the chat tool's option is called `heatmap`.
