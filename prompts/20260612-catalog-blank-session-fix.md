---
date: "2026-06-12"
task: "fix: catalog models with surface ops open as blank starters"
files_changed:
  - src/main.ts
---

## Human

After deploying the PR preview, spiral staircase, royal crown, treasure chest, and castle tower all opened as blank starter sessions. D20, ghost, lantern, and ringed planet worked fine.

## Assistant

Root cause: `loadVersionIntoEditor` (called by `importSessionPayload`) runs `runCodeSync` without `skipSurface`, triggering the surface Worker for any model that uses `api.surface.*` ops (voronoi, knurl, woven). The surface Worker awaits `computeChain()`, which runs 30–120s on complex catalog models. `applySurfaceTextures` catches its own errors and returns gracefully rather than re-throwing — so the import doesn't fail, it just hangs indefinitely. The `loadCatalogFileIntoEditor` catch block never fires; instead the `importSessionPayload` promise never resolves, and the session is seeded as a blank starter.

The 4 failing models (spiral staircase, royal crown, treasure chest, castle tower) all have `api.surface.*` calls. The 4 working models (D20, ghost, lantern, ringed planet) have no surface ops.

**Fix**: Added `skipSurface?: boolean` to `loadVersionIntoEditor`'s opts, and passed `skipSurface: true` from `importSessionPayload`. Surface textures are deferred to the first user-triggered run (or the Re-apply pill if the chain is parked). This is the same pattern already used in the thumbnail callback.
