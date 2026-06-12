---
date: 2026-06-12
branch: claude/elegant-turing-sjwiei-voxel-smooth
files_changed:
  - src/geometry/voxel/grid.ts
  - src/geometry/voxel/mesher.ts
---

## Human

Pre-production-release review of `main`. Fix critical defects from the recent
merge window before cutting the release.

## Assistant

The voxel mesher and the rest of the app disagreed on the default smoothing
algorithm. `grid.ts`'s `DEFAULT_SMOOTH_ALGORITHM` (what a bare `.smooth()`
stamps) and the Voxel Studio UI both default to `surfaceNets`, but the mesher's
`smoothAlgorithm()` fallback for a `Surfacing` with `algorithm: undefined`
returned `taubin`. Such an object can't come from `VoxelGrid.smooth()` (which
always stamps the field), but it can from `clone()` of an older surfacing or
direct construction — and then the mesh renders `taubin` while the UI claims
`surfaceNets`, and the "Update code" round-trip (which suppresses the
`surfaceNets` default in codegen) silently re-renders it as `surfaceNets`.

Fix: export `DEFAULT_SMOOTH_ALGORITHM` from `grid.ts` and have the mesher fall
back to it, so there's a single source of truth and mesher/UI/codegen agree.

Verified: typecheck + the voxel unit tier (175 tests) pass.
