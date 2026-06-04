---
date: 2026-06-04
branch: claude/friendly-lamport-Bdf5m
pr: 368
files_changed:
  - src/color/imagePaint.ts
  - src/color/imagePaintUI.ts
  - src/color/regions.ts
  - src/main.ts
---

## Human

Stamps with edge smoothing ON disappear after clicking Save then refreshing the page. Regular (non-smooth) stamps persist correctly.

## Assistant

Root cause: `descriptorRefines()` returns `false` for `imagePaint` descriptors, so `rehydrateColorRegions` on reload routes them through the standard `refineMeshPipeline`, which simply re-stamps the stored triangle indices (M0 indices) onto M0. For a smooth stamp this is wrong: the smooth path calls `smoothReplayCb` which runs a mesh-refinement pass (M0 → M1) and then stamps against M1. After a reload the descriptor's stored `entries` (M1-indexed) are invalid against M0, so zero triangles match and the stamp is silently dropped.

Fix: extend the `imagePaint` descriptor with the fields needed to replay the smooth stamp from scratch — `imageDataUrl` (compact PNG), `hitPoint`, `hitNormal`, `stampSize`, `rotationDeg`, `maxEdge`, `removeBackground`, `manualBgColor`, `bgTolerance`. On reload, `rehydrateColorRegions` partitions regions into standard (handled by `refineMeshPipeline`) and smooth-imagePaint (replayed sequentially through `smoothReplayCb`, accumulating M0→M1→M2→… so each subsequent stamp targets the correct already-refined mesh). Made `rehydrateColorRegions` and its caller `restoreBaselineColors` async to allow awaiting image URL decoding between stamps.

Also bumped the localStorage persistence key from `imagePaint_savedImage` to `imagePaint_savedImage_v2` to invalidate stale JPEG-encoded entries that would still cause eyes to be stripped despite the PNG fix (old stale data predates the PNG switch).

Added `compactImageDataUrl` helper that downsamples to max 256 px before PNG-encoding — keeps the per-descriptor payload small (< 50 KB) for storage in IndexedDB session data.
