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
If the open object's newest version predates stored meshes, the live mesh is
used, but only when the editor shows exactly that version. Share links strip the
mesh and keep the fingerprint. The exportSession API now also accepts
includeChat, which the dialog already offered but the API rejected.
