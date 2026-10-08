# Retro — figure footwear resize + catalog re-bake (PRs #737, #739)

## Liked
- `git blame` + commit *dates* nailed the root cause in minutes: the footwear
  (2026-06-13) was sized for a foot the next day's reshape (2026-06-14) shrank.
  "When did each side of this mismatch last change?" beat staring at the math.
- `model:preview` side-view crops gave fast, honest before/after evidence; the
  shoe/foot bounds-ratio (1.69 → 1.27) turned a visual judgement into a number
  I could assert in a regression test.

## Lacked
- No structural link between a figure-*builder* change and the *baked* catalog
  artifacts it invalidates. The example source is unchanged, so codeHash matches
  and nothing flags that 14 baked entries are now stale. The only signal was the
  user noticing in the catalog grid.
- No committed generator/jobs for the figure catalog entries (only sdf_/scad_).
  Re-baking meant reconstructing the recipe (camera, paint replay) from the
  baked files themselves.

## Learned
- Catalog `.partwright.json` entries store baked geometryData + thumbnail AND a
  replayable paint recipe (`colorRegions[].descriptor` = `{kind:'byLabel',label}`
  + color). That makes a faithful in-place re-bake easy: re-run the stored code,
  replay byLabel paint in `order`, splice only geometryData/colorRegions/thumbnail
  back. Standard hero camera is 30°/45°.
- The coverage-underlayer heel offset was measured *behind the ankle*, not from
  the origin — I first "fixed" it to a value coincidentally equal to the old one
  (footLen*0.12 + r.foot ≈ footLen*0.38). The empirical bounds-ratio check caught
  that the visual win wasn't matched by the number. Measure, don't eyeball.

## Longed for
- A "baked-artifact staleness" check: when a figure builder changes, surface
  which catalog entries' code transitively depends on it so the re-bake isn't
  discovered by a user. Even a manual `npm run catalog:rebake -- --figures` that
  re-runs+re-paints+re-thumbs in place (generalizing scripts/rebake-shod-figures.cjs)
  would remove the per-incident scripting.
