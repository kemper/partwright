---
date: 2026-10-25
task: "#1093 parts 1b/3/4 — scoped round/smoothWeld, api.editPart, diffVersions geometry"
---

## Liked
- `model:preview` + a tiny `pv.sh` wrapper (time, manifold, components, bbox,
  labels on one line) made the dozens of geometry iterations cheap; most bugs
  were caught by "componentCount != 1" or a bbox off by half a voxel.
- `--explain-components` immediately showed whether stray pieces were
  zero-volume shells, inside-out pockets or real chips — three different fixes.

## Lacked
- No profiler for sandbox ops: every slowdown (BVH queries, levelSet, booleans,
  decompose) needed hand-inserted `console.error` timers in a copy of the file.
- The in-app `renderView` azimuth convention (0 = front) differs from
  `model:preview --view` (0 = +X); I chased a "missing arm" that was just
  behind the body.

## Learned
- Booleans between two meshes of (nearly) the same surface are the real enemy:
  coincident cut faces and interleaving surfaces both shatter into thousands of
  slivers. Lift one side, nest the cut inside the cover, then re-merge and drop
  zero-volume / small inside-out shells.
- Raster morphology shifts faces by a lattice-dependent sub-voxel amount — fine
  for a full remesh, fatal for a splice. Exact distances + iso-crossing clouds
  fixed it.
- `getMesh()` from manifold-3d exposes `numTri` as a getter: spreading it into a
  plain object silently loses it.

## Longed for
- A `model:preview --profile` flag that times each `api.*` call in the snippet.
- One azimuth convention across renderView, model:preview and photoMatch (or a
  loud note in each tool's description).
