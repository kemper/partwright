---
date: "2026-06-12"
task: "feat: rig.sole frames + F.standOn, flat footwear soles flush on the base"
pr: 634
areas: [figure, sdf, docs, catalog, tests]
---

## Human

The shoes/boots go through the pedestal the superhero stands on. Like we did with hand grip location, do we need a concept for how to connect things to the bottom of the feet so AI agents aren't guessing where they go? Also the boots aren't particularly flat on the bottom, which I'd like.

(After diagnosis + a scope question, the user chose to add the full concept in this PR.)

## Assistant

The clipping and the rounded soles were two symptoms of one root cause: "where the foot meets the ground" was scattered and private — `footSoleZ()` was an internal helper, footprint length was a magic `r.foot * 2.4`, and `buildFeet` / `buildFootwear` / `buildBase` each recomputed the sole independently, so they drifted (footwear extended below the base and punched through).

**Decision: add a sole frame, the foot analog of `rig.grip`.** Introduced `SoleFrame { point, normal, heading, length, width, groundZ }` exposed as `rig.sole.L/R`, computed once in `buildRig` via a single `makeSoleFrame` helper that shares `footSoleZ`'s basis. `buildFeet` and `buildFootwear` now derive their ground plane / footprint / heading from it, so they can't drift. Verified the bare-foot output is byte-identical (`sz = groundZ + r.foot*0.62 == footSoleZ`), so existing figures/tests are unaffected.

**`F.standOn(node, rig.sole.L|R, opts?)`** — the `holdAt` analog for feet: drops a node's bbox anchor on the sole point (`anchor` default `'top'` so a skate/platform hangs below the foot). Gives agents the canonical attach point they were guessing at, mirroring how `holdAt`/`spanGrips` solved it for hands.

**Flat soles**: footwear now intersects a ground-plane half-space (`z >= groundZ`), slicing off the rounded capsule underside. Because the flat cut is at `groundZ` ≈ the base's bottom plane, this *also* fixes the clip-through (nothing extends below the base) — one change resolves both the user's complaints. Confirmed visually (superhero front/right: flat soles flush on the disc) and that `standOn` seats platforms flush under each foot, all `isManifold: true`, `componentCount: 1`.

Also surfaced the frames in `poseProbe` (the discovery tool) so an agent reading a pose sees `soles: L.point … groundZ …`. Docs in `public/ai/figure.md` (sole frame in the rig reference + a `F.standOn` section + flat-sole note on footwear). Rebaked `superhero.partwright.json`. 8 new unit tests (sole frame derivation, turnout tracking, flat-bottom clip, `standOn` anchoring, poseProbe).
