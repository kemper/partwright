---
date: 2026-06-18
component: catalog (shod figure entries) — re-bake for the offset-shoe redesign
---

## Human

(On PR #739.) Rebake the catalog entries as part of 739 to prove [the offset-shoe
redesign #750] works, be sure to update to the latest main before starting.

## Assistant

Updated #739 to latest main and merged the offset-shoe redesign (#750) in,
resolving the `sdfFigure.ts` conflict in favour of #750 (it supersedes the interim
#737 resize + #745 flat-sole patch this branch previously carried). Then re-ran
`scripts/rebake-shod-figures.cjs` over all 14 shod entries against the redesigned
builder.

All 14 re-bake manifold, single-component, paint regions replayed without error,
region counts unchanged; the diff is geometryData + colorRegions + thumbnail only
(code/notes/names preserved). Before/after catalog thumbnails confirm the fix in
the real renders: rock-climber's lifted "bubble" foot → a clean red climbing shoe;
sprinter's club shoe → compact sneakers. Colours preserved.
