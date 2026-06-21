---
date: 2026-06-18
component: catalog (shod figure entries) — second re-bake
---

## Human

(On PR #739.) You also need to update from latest main for pr 739. [plus the
rock-climber/sprinter bubble-foot fix landed as #745.]

## Assistant

Updated #739 from `origin/main` (resolved the one conflict — `runway_model`, which
main had re-baked for the floor-length-gown chest fix — by taking main's gown-fixed
copy, then re-baking it fresh below). Merged the plantarflex flat-sole fix branch
(#745) into #739 so the catalog bakes reflect BOTH the footwear resize (#737, now
on main) AND the bubble-foot fix.

Re-ran `scripts/rebake-shod-figures.cjs` over all 14 shod entries against the
combined builder. All 14 came back manifold, single-component, paint regions
replayed without error, region counts unchanged. The rock-climber catalog
thumbnail now shows a red climbing shoe on the lifted foot instead of the bubble;
colours preserved. runway_model carries the gown fix + footwear/plantarflex fixes
together (tris 396574).
