---
session: "beautiful-pascal-z0esff"
timestamp: "2026-06-18T22:07:34Z"
model: claude-opus-4-8
---

## Human

Loaded the Christmas tree from the catalog, clicked "+" to create a few new
parts, clicked away to a new part and back to the tree. The tree now has no
color in the interactive view. As soon as any paint operation is applied, the
full color snaps back.

## Assistant

## Key decisions

**Root cause** (distinct from the earlier interactive-paint fix in this PR):
the Christmas tree's colors are declared IN CODE (`api.label` / `api.paint`),
so they live as `modelRegions` (set via `setModelColorRegions`), NOT as user
paint regions in `geometryData.colorRegions`. In `loadVersionIntoEditor`'s
**cache-hit branch**, the part is restored by `updateMesh(cachedEntry.meshData)`
— the *uncolored* base mesh — relying on the later
`rehydrateColorRegions(version.geometryData)` to re-color. But that function
returns early when there are no USER regions, so a model-colored part with no
hand paint restored from cache as the bare blue base. Any subsequent paint op
ran `paintedColorRefresh` → `applyTriColorsIfVisible`, which stamps model
regions too — hence the color "snapping back". The "+"/switch dance is just
what turns the return into a cache hit (the tree mesh is still cached).

**Fix**: In the cache-hit branch, render the model colors when present —
`updateMesh(hasModelColorRegions() ? applyTriColorsIfVisible(cachedEntry.meshData) : cachedEntry.meshData)`.
`setModelColorRegions(cachedEntry.modelColorDecls)` runs just above, so
`hasModelColorRegions()` is already true and the cached decls carry their
triangle sets. The paint mesh stays the uncolored base (it backs hit-testing).
User-paint parts are unaffected: `rehydrateColorRegions` still re-renders for
them, and `applyTriColorsIfVisible` returns the mesh unchanged when no regions
exist.

**Verification**: Added `tests/model-color-part-switch-survival.spec.ts`
(load the tree catalog entry, add parts via the + button, switch away and
back, assert the displayed mesh still has non-default-blue vertices). Fails
before / passes after. Ran model-declared-color, paint-render-color,
parts, fork-color-carry, surface-paint-survival, catalog-paint-migration,
and the earlier paint-part-switch spec — all green. Typecheck clean. Visual
screenshot confirms the green/gold tree renders after the round-trip.
