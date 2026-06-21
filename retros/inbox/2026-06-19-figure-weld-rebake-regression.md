# Retro — figure weld tuning + catalog re-bake (PR #776)

## Liked
- `model:preview`'s fast render→look loop made the aesthetic weld/deltoid tuning
  cheap: testing a `weld {k}` override on a scratch copy of the swimmer BEFORE
  touching source proved the root cause (oversized fillet bridging the armpit) in
  one render, no source edit.

## Lacked
- The headless `componentCount` under-reports vs the browser bake for
  near-threshold thin connections (documented), and it bit me: `model:preview`
  said the danseur was 1 component at `k=0.32` while the real bake split it into 2.
  A global geometry knob (weld k) needs validation on the WORST pose, not the
  reported example — the swimmer (arms down) looked perfect while a raised-arm
  figure silently tore off.

## Learned
- A figure-wide weld/deltoid change has TWO opposing constraints: hanging arms
  need a *small* k to de-web the armpit, raised arms need a *large enough* k
  because the shoulder is their only torso bridge. The safe value is a window
  (~0.32–0.6 here → 0.48), found only by baking both extremes.
- The catalog `.partwright.json` entries are baked meshes — a shared
  `sdfFigure.ts` fix doesn't reach the gallery until `rebake-figure-catalog.cjs`
  re-runs. The re-bake's per-entry `components=`/`NOT-MANIFOLD` flags are a free
  regression gate across 51 real poses; read them, don't just trust "Done".

## Longed for
- A cheap headless "does this figure stay one component in the BROWSER bake"
  check per pose, so a global rig change can be gated against every catalog pose
  in the fast loop instead of discovering a split only at full re-bake time.
