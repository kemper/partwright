---
session: "01U8g7w9"
timestamp: "2026-10-28T03:00:00Z"
sequence: 13
---

## Human

Go with the fingerprint plus newest-mesh approach. The partwright JSON export
should have an option to include the latest mesh data. Look for other product
areas that need to change too; use your best judgment. Don't duplicate the mesh
when the object is already a mesh.

## Assistant

## Key decisions

**Why this exists.** A version stores code, and opening it re-runs that code on
the current engine, so any release that changes a builder silently changes saved
models. A mesh on every version would make a session 50–100× bigger (a dressed
human is ~2.5 MB), so each version stores a ~100-byte fingerprint and only each
object's newest version keeps its mesh.

**The fingerprint has an exact hash plus tolerant measurements.** The hash makes
an unchanged model match instantly. Volume, area, bounds, surface centroid and
exact second moments are compared with a 1e-5 relative tolerance, so float noise
between browsers never reads as a change but a real edit does. The second moments
use the exact per-triangle formula: the triangle-centroid approximation changed
when the same surface was triangulated differently (a unit test caught it).
Versions saved before fingerprints are compared on the stats they already store,
skipping triangle counts (paint refinement changes them) and any case where
those stats can't describe the run (other code, a texture not applied this time).

**The fingerprint describes the engine's mesh; the stored mesh is what the user
saw.** The fingerprint is taken before in-code textures and paint refinement, so
it is the same on every rebuild. The stored mesh is the displayed one with its
colours, so "restore" brings back exactly what was on screen. A save records a
snapshot only when the live run was built from exactly that code and those
Customizer values; save paths that commit other code get none.

**No second copy of a mesh.** No mesh is kept when the version's model is
already stored mesh data: imports and bakes, an in-code surface texture (which
already holds the finished mesh), or a baked voxel grid. A restored model becomes
an import-backed version, so it doesn't duplicate either.

**Only the newest mesh is kept.** Each save drops the previous newest version's
mesh in the same IndexedDB transaction, chained from callbacks. The previous
newest is found with the cursor that already finds the next index, so no other
versions are read.

**Drift is a persistent pill, not a toast.** The pill stays while the drifted
version is on screen. Its dialog shows the saved thumbnail, explains where the
difference came from, and offers Restore (bake the saved mesh as a new version,
colours carried), Keep (force-save the rebuilt model) or Ignore (remembered per
version on this device, so a stale catalog bake doesn't nag on every reload).
Console API: getModelDrift / restoreSavedModel / keepRebuiltModel, and
loadVersion reports it. AI tools: getModelDrift (always available) and
resolveModelDrift (save-gated; ask the user first).

**Export.** Schema 1.22 writes the fingerprint always and the newest meshes only
with includeLatestMeshes (off by default; also a checkbox in the export dialog).
Share links strip the mesh and keep the fingerprint. The exportSession API now also accepts
includeChat, which the dialog already offered but the API rejected.

## Review fixes (same PR)

A review pass found false alarms and unsafe edges. All are fixed in this PR:

- **Curvature quality.** Quality isn't saved with a version and resets on
  reload, so a model saved at High would open as "changed". The fingerprint now
  records its segment count, and drift is only compared at equal quality.
- **No stats comparison for old saves.** It was dropped entirely: the stats can
  come from another quality setting or another machine's bake (catalog entries
  differed by up to 10% in volume). Old versions get a fingerprint the next time
  they're saved.
- **Matching runs to saves.** Matching now goes through the editor's
  auto-formatting, and the run record is tied to the object, its imports and its
  companion files. The record is cleared on a failed run and at every version
  load, and carried through the object mesh cache, so a cache-hit switch still
  records the right snapshot.
- **Restore.** It checks that the saved mesh is a closed solid, and comes back
  render-only when it isn't. Stored meshes keep only x/y/z, and triangle
  indices are validated on load. Restoring a voxel model warns that it becomes
  a mesh. Making the shared bake path refuse to save a run that errored was
  tried and backed out: the sloped-face engrave test relies on the old
  behaviour (it bakes a mesh that isn't a solid), so that is filed separately.
- **Who can write.** Read-only viewer tabs and shared previews can't restore or
  keep.
- **Ignore.** It is remembered per version on this device, and has an API twin
  (dismissModelDrift) and an AI tool choice.
- **Cost.** Import-backed saves skip the snapshot, the content hash runs over
  32-bit words, and the fingerprint is memoised per run.
- **Export.** The live-mesh fallback is gone, since it could embed unsaved paint.

## Merge with main: tool groups

Main added on-demand AI tool groups (#1175), and every tool must sit in core or
in exactly one group. Main itself was red on that check: `listExportItems`,
`partAction` and `undoPartEdit` had merged without a group. This PR ports the
fix: those go in `objects`, and the drift tools go in `versions`. The drift
tools stay out of core, so the turn-0 tool budget holds; `loadVersion` (core)
still reports drift.
