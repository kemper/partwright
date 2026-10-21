---
date: "2026-06-14T19:56:00Z"
task: "feat: realistic figure noses — carved nostrils + nose-type presets"
pr: 673
areas: [figure-api, geometry, tooling]
cost: medium
---

## Liked / Worked
- The SDF `evaluate` probe via `vite-node` (importing `__figureTestables__` + sdf `__testables__`) was the single highest-leverage tool here — it turned "why don't the nostrils show?" from blind camera-angle guessing into a measured fact (surface at 1.65·tipR below the tip, cavity buried at 0.92). The CLAUDE.md note about measuring smoothUnion bulge is correct and underused.
- Building the nostril placement *from* a runtime `surfaceDrop()` sample (rather than per-preset magic numbers) made the carve robust across all 8 presets and any flare/width automatically — one mechanism instead of eight tuning passes.
- `model:preview --view "az,el;az,el"` + `sharp(...).extract(...)` crops at size 1400+ were essential; the nostrils were invisible at the default tile size and obvious once cropped to 700px.

## Lacked
- Burned ~4 turns guessing camera angles (270,-40 etc.) before realizing the "nose bump with dimples" I kept cropping was self-occluding the nostrils and I should just probe the SDF. The lesson "measure, don't eyeball" applies to *diagnosis*, not only to final placement — I reached for it one stage too late.
- `model:preview` auto-cleans prior stamps for the same model, so I lost the original blob render and couldn't build a true before/after crop. For an A/B I should copy the baseline PNG to a stable path *before* the next render.

## Learned
- The structural `Node` interface in `sdfFigure.ts` deliberately omits `evaluate`, but the real runtime nodes have it — `(node as unknown as { evaluate }).evaluate(...)` is the cast to sample geometry inside a builder. Cheap enough (~30 calls/nose) to do at build time.
- Several existing example figures passed `nose: { length: r.head * 0.22 }` treating `length` as an absolute world value, but it's a 0.3–2 *multiplier* — they only worked because the product happened to land in range. Switching them to `type:` presets also fixed that latent semantic bug.

## Longed for
- A `--keep` / stable-output flag on `model:preview` (or a documented "copy before re-render" step) so before/after comparisons survive the auto-clean of stamped PNGs.
- A tiny reusable `probeSurface(node, origin, dir)` helper in the figure test-ables so builders that need to find a smoothUnion-bulged surface don't re-implement the walk-until-sign-flip loop each time.
