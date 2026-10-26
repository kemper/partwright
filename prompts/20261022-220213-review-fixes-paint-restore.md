---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-22T22:05:00Z"
tools: [subagent]
---

## Human

(Continuation.) Drive PR #1052 to mergeable. A review subagent audited the combined diff.

## Assistant

## Key decisions

**Stroke grid vs the straight-edge skip (blocking).** The sample grid clamps far field values to its bound, so a big triangle's six field samples could all read the same value. The refiner took that as a provably straight boundary and skipped the triangle, so a long stroke inside one coarse face painted nothing. This also affected saved strokes on load. `RefineRegion` now carries `fieldBound`, and the skip is disabled wherever any sample reaches it. A regression test (a 49-sample stroke inside one 100-unit triangle) fails before the fix and passes after. Chose this over dropping the clamp: the clamp is what makes far queries cheap.

**Restore aborts (blocking).** Any paint reset terminates the worker, and `refineForRehydrate` treated that as a failure, rebuilding the old version on the main thread over the new state. It now returns "superseded" on any abort, on a newer rehydrate, or on a `paintGeneration` change. The modal gets a Cancel, which keeps the saved paint for the next run.

**Store empty during the restore.** The version's descriptors stay staged (unresolved) while the worker refines, so a save in that window keeps them and a takeover leaves them for the next run. They are cleared and re-added once the refine lands.

**Defer flag tied to the run.** It was a boolean; now it is the load run's generation, so an unrelated run that starts meanwhile still resolves its own regions.

**Config.** `paintStroke`'s default resolution and the path-spacing fraction moved to `ui.paintStrokeResolution` / `ui.paintStrokePathSpacing`, with Advanced Settings fields, per the no-hardcoded-knobs rule.

**Probe cache memory.** The cache is keyed weakly on the mesh, so it no longer pins the last probed mesh.
