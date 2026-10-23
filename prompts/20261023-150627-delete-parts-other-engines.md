---
session: "017xgfPQK41H8feC99NhRjKm"
timestamp: "2026-10-23T15:06:27Z"
tools: [playwright]
---

## Human

"work on #1058 next" — delete parts/pieces from the object list on SCAD,
BREP and imported-mesh parts (and voxel pieces), or have the ✕ explain up
front why it can't.

## Assistant

## Key decisions

Same principle as the manifold-js delete: one removal line at the top of the
code, re-run, verify, save a version. Each engine gets the mechanism that
matches how its parts exist.

**OpenSCAD.** Parts are top-level `label("name") …;` statements that
lazy-union emits as separate AMF objects. `remove_part("name");` /
`remove_piece([x,y,z]);` are no-op modules added to the one-line prefix (so
OpenSCAD accepts them and error-line shifting stays at 1). The source scanner
records them and leaves them out of the geometry-statement count, so the
statement-to-object mapping isn't thrown off. The engine skips the removed
object before composing (exact, no geometry editing) and drops pieces with the
shared `withoutPiecesAt` (moved out of manifoldJs into
`src/geometry/removePieces.ts`). The fast low-$fn preview is skipped when parts
are removed, because the flat preview can't drop them and the part would flash
back.

**BREP.** Tested in the browser first: OCCT treats an empty compound as a
no-op operand in fuse/cut/intersect, transforms and fuseAll; only
fillet/chamfer reject it, and those now no-op on empty shapes.
`api.removePart` (replicad and manifold-js Phase C) hands a per-run set to
brepRuntime, and `BREP.label` returns `makeCompound([])` for a removed name.
Done at BREP level rather than on the mesh so **STEP export stays consistent**.
Piece delete on BREP is not supported (it would need OCCT solid
classification). The ✕ is shown disabled with a tooltip suggesting the
workaround (label the piece, delete the part), which meets the issue's
"explain up front" bar.

**Parts detected on imports.** These aren't `api.label` calls, so
`importWithParts` now honours `api.removePart`. It drops the part's
triangles and caps every opening with a fan to the loop centroid (new pure
`removeImportPartTriangles`). Each cap joins the part owning most of its rim,
so the base keeps covering its whole surface rather than gaining an
"Unlabeled" patch. Verified: the stepped block minus "top" is manifold with
volume 4000.

**Voxel pieces.** `api.removePiece` in the voxel sandbox (both the engine and
voxel paint run paths, via `createVoxelApi`). New
`VoxelGrid.removePieceAt` floods the face-connected piece from the occupied
voxel nearest the point. Voxel objects have no parts, so that ✕ explains it.

**UI.** `canDeleteObjectParts()` became a per-key
`getObjectPartDelete(key) → {show, reason?}`. A blocked ✕ is dimmed, marked
`aria-disabled`, and shows its reason as tooltip and toast.
