---
date: 2026-06-04
branch: claude/part-mesh-cache
files_changed:
  - src/main.ts
---

## Human

Code review before testing — run work-reviewer and code-review subagents.

## Assistant

Three correctness bugs surfaced by the work-reviewer, fixed in this commit:

**Double-refinement on cache hit after save.**
`saveCurrentVersion` was caching `currentMeshData`, which for a painted+refined
version is the post-subdivision mesh. On cache hit, `loadVersionIntoEditor`
restored `paintBaseMesh = cachedEntry.meshData` (the refined mesh), then
`rehydrateColorRegions` called `refineMeshForRegions(refinedMesh, ...)` — a
second pass over already-subdivided geometry, misaligning triangle indices.
Fix: cache `paintBaseMesh ?? currentMeshData` (the coarse pre-paint base) so
`rehydrateColorRegions` always gets the right starting point.

**Stale mesh cached under new version id in `confirmRemoveCompanion`.**
`confirmRemoveCompanion` fired `runCode()` (async, no-await) then immediately
`void saveCurrentVersion()`. The save completed before the recompile, so the
new version's id was cached against the old (pre-removal) mesh. Fix: replaced
`runCode` with `await runCodeSync` so the mesh is correct before saving.

**Printability pill stale after cache hit.**
The cache-hit branch set `geometryDataEl.textContent` directly but never called
`computePrintability` / updated `printabilityIndicatorEl`. The previous part's
pill persisted. Fix: after setting `geometryDataEl.textContent`, read the
same `version.geometryData` through `computePrintability` and update the pill.

Also: snap `new Set(r.triangles)` at both cache-population sites to avoid
aliasing into the live region store.
