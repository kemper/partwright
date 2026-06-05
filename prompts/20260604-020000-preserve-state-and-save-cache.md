---
date: 2026-06-04
branch: claude/part-mesh-cache
files_changed:
  - src/main.ts
---

## Human

When I paint a model and switch from one part to another, the color is lost.
Once I do save, that causes a rerender which takes a while — all I did was
colour. What's the simple and holistic fix that best solves all the problems
(annotations, params, companion files, etc.)?

## Assistant

Two independent bugs, both in `src/main.ts`, one fix each:

**Bug 1 — unsaved state (paint, annotations, params, companions) silently
discarded on part switch.**
`preserveCurrentEditsIfNeeded` had an early-return when the code text was
unchanged: `if (code === s.currentVersion.code) return;`. This bypassed the
`saveVersion` call entirely, so any state that lives *outside* the code string
— color regions, annotations, param values, companion files — was never
persisted before the switch. Fix: remove the early-return. The `saveVersion`
dedup logic in `sessionManager.ts` is already authoritative: it compares code +
annotations + colorRegions + paramValues + companions and returns `{skipped}`
when truly nothing changed, so there is no double-save problem.

**Bug 2 — saving a painted model triggers a recompile on switch-back.**
After Mod+S, `saveCurrentVersion` creates a new `version.id`. The per-version
mesh cache (`partMeshCache`) was keyed by the *old* `version.id`, so the new
id was always a cache miss and `loadVersionIntoEditor` re-ran `runCodeSync`.
Fix: after a successful `saveVersion` call in `saveCurrentVersion`, populate
`partMeshCache` with the new `version.id` using the current `currentMeshData`
and friends — same LRU eviction logic as the cache-miss path.
