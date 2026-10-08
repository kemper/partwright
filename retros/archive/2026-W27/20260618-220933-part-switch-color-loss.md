# Retro — part-switch color loss (two bugs)

**Task:** User reported painted parts returning uncolored after switching parts. Turned into two distinct bugs sharing one symptom.

## Liked
- `getMeshGroup()` is importable in-page via `import('/src/renderer/viewport.ts')`, so a spec can read the *actual displayed* three.js `color` attribute. This was the decisive instrument — `listRegions()` alone said "fine" (regions survived) while the render was blank, which is exactly how the user saw it. Asserting on rendered vertex colors, not just the region store, is what separated the two bugs.

## Lacked
- No quick way to tell "is the displayed mesh colored?" without hand-rolling the viewport-import + default-blue-threshold helper in each scratch spec. I wrote essentially the same `coloredVerts(page)` helper twice. A shared test helper (e.g. `tests/helpers/renderedColors.ts`) would save the next person rebuilding it.

## Learned
- The same user-visible symptom ("part comes back uncolored") had two unrelated causes: (1) unsaved interactive paint dropped by an `isStarterCode` early-return in the part-switch auto-save, and (2) in-code *model* colors (`api.label`/`api.paint`) not re-applied in `loadVersionIntoEditor`'s **cache-hit** branch. The cache-hit branch is a recurring trap: it bypasses `runCodeSync`'s coloring, and `rehydrateColorRegions` only re-renders for *user* regions — so model-only colors silently vanish there. Worth checking that branch whenever color/render state is involved.
- "It snaps back as soon as I paint" is a strong tell that the color *data* is present but the *render* wasn't refreshed — points at a missing `applyTriColorsIfVisible` on a restore path, not at lost data.

## Longed for
- A first-class "is this part's color the same before vs after a round-trip?" assertion. More broadly, the part-mesh cache-hit branch re-implements a slice of the run/render path by hand; every field it forgets (here: model-color rendering) is a latent bug. A single `renderRestoredPart(entry)` helper that both the cache-hit branch and a test could share would prevent that drift class.
