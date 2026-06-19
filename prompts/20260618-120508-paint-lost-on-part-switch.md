---
session: "beautiful-pascal-z0esff"
timestamp: "2026-06-18T12:05:08Z"
model: claude-opus-4-8
---

## Human

With multiple parts in the left-hand part list: paint a part, switch to
another part, then switch back to the previously painted part — it returns
completely uncolored in the interactive view. Reportedly happens even after
saving. Investigate and fix.

## Assistant

## Key decisions

**Root cause**: `preserveCurrentEditsIfNeeded()` (`src/main.ts`) is the
part-switch chokepoint — `onSelectPart` calls it to auto-save the outgoing
part's unsaved work before `changePart`. It bailed early on
`isStarterCode(code)` to avoid creating a version for a freshly-created,
untouched part. But that guard didn't account for interactive paint applied
on top of the starter geometry: a part painted but never run/saved into had
its paint silently dropped on switch (no version written → no
`geometryData.colorRegions` → `rehydrateColorRegions` finds nothing → the
part reopens with zero regions). Reproduced empirically: with a real-code
part the auto-save runs and paint survives; with a starter-code part
`listRegions()` returned 0 after the round-trip.

**Fix**: Changed the guard to
`if (isStarterCode(code) && !hasColorRegions()) return;`. A truly untouched
starter part (no paint) still isn't saved — `hasColorRegions()` is false and
the early return holds, so version history isn't polluted. When paint exists,
the auto-save runs; `saveVersion` already dedupes on the colour-region axis,
and `enrichGeometryDataWithColors` persists the regions so
`rehydrateColorRegions` restores them on switch-back. `hasColorRegions` was
already imported in `main.ts`.

**Scope**: Kept the fix to paint (the reported symptom). The same early-exit
philosophy means a starter part with only annotations/param overrides would
still be skipped, but that's not the reported bug; noted as a possible
follow-up. The explicit-save path (`saveCurrentVersion`, mod+S) never had the
`isStarterCode` guard, which is why an explicit save already worked — the
"even after saving" report most likely traced to the same unsaved
starter-code path.

**Verification**: Added `tests/paint-part-switch-survival.spec.ts` (paint a
starter-code part, switch away and back, assert `listRegions()` survives).
Confirmed it fails before / passes after. Ran parts/import/save-after-paint
specs (18 passed), unit tier (1476 passed), typecheck, and a visual
screenshot of the painted cone rendering correctly post-round-trip.
