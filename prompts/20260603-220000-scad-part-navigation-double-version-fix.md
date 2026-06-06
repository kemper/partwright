---
date: 2026-06-03
branch: claude/funny-galileo-C7Gs1
files_changed:
  - src/main.ts
---

## Human

Ok, I can now import a new scad file that creates a new part and shows the
companion text pane. However, when I clicked on part 1 and back to part 2,
part 2 still ended up with 2 versions.

## Assistant

Two concurrent `saveVersion` calls racing at the macro-task boundary inside
`captureThumbnail`.

**Root cause**: `applyCodeToCurrentPart` calls `await captureThumbnail()` after
`runCodeSync` completes. `captureThumbnail` uses `canvas.toBlob()` and
`setTimeout` — both are macro-task callbacks. A click event (user navigates to
Part 1) can fire while waiting for the thumbnail. At that point:

- `preserveCurrentEditsIfNeeded` sees `currentVersion = null` (the import
  hasn't saved yet) and saves version 1 for Part 2.
- `applyCodeToCurrentPart`'s thumbnail then resolves and `saveVersion(force:true)`
  saves version 2 — regardless of dedup, because `force: true` bypasses it.

There are two orderings of the competing `captureThumbnail` macro-tasks:

- **Case A** (applyCodeToCurrentPart wins): saves version 1 with companions.
  `preserveCurrentEditsIfNeeded` then deduplicates correctly — it inherits
  companions from the saved version, so code + companions match and the save is
  skipped.
- **Case B** (preserveCurrentEditsIfNeeded wins): saves version 1. `changePart`
  runs after. Then `applyCodeToCurrentPart`'s thumbnail resolves — the active
  part has already changed — and would save to the wrong part.

**Fix — two changes in `src/main.ts`**:

1. `applyCodeToCurrentPart`: snapshot `partIdBeforeRun` before `runCodeSync`.
   After `runCodeSync` returns, bail out if it was cancelled (`!ran`). After
   `captureThumbnail`, bail out if the active part changed. This covers both
   the slow-compile cancellation and the Case B thumbnail race.

2. `preserveCurrentEditsIfNeeded`: pass `companionFiles: getCompanionFiles()`
   (for SCAD) to `saveVersion`. This ensures that when `applyCodeToCurrentPart`
   wins (Case A), the dedup check sees matching companions and skips the second
   save from `preserveCurrentEditsIfNeeded`. Previously companions were always
   inherited from `currentVersion`, which was `null` for a new part — so the
   saved version had empty companions and dedup could not match them against the
   forced re-save.
