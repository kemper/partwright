---
date: "2026-06-12"
task: "feat: clothing.shoes / clothing.boots footwear builder for the figure API"
pr: draft
areas: [figure, sdf, docs, catalog, tests]
---

## Human

Look at issue #618 — clothing.shoes / clothing.boots builder — contained new builder. Investigate, report an implementation plan, then implement the feature and refactor the superhero example. Create a PR.

## Assistant

Added first-class footwear so shoes/boots aren't hand-rolled raw SDF per example.

**Design decisions:**

1. **One shared `buildFootwear(sdf, rig, opts, kind)`** with thin `buildShoes`/`buildBoots` wrappers, rather than two parallel builders — shoes are just boots without the shaft, so a single core avoids drift. Placed right after `buildFeet`.

2. **Mirror `buildFeet` geometry, inflated by `thickness`.** Footwear reads `rig.joints.footL/R` + `rig.dir.footL/R` and rebuilds the sole capsule / instep ellipsoid / ankle collar with `+t` radii and a `size` footprint scale. Reusing the same `fwd`/`lat` heading vectors means footwear tracks `leg*.twist` turnout for free, exactly like `F.feet` — that's the acceptance criterion, met structurally rather than re-derived.

3. **Boot shaft `shaftZ` projects onto the posed ankle→knee bone**, copying pants' `cuffPoint` pattern (world-Z target → fraction along the bone). A fixed world-Z endpoint would pull the shaft off a lunge's diagonal shank; projection keeps it on the bone in any pose. Default ~mid-calf.

4. **Guaranteed-coverage underlayer** (the `buildPants`/`buildTop` convention): the body's own foot mass (plus the lower-leg shank for boots) offset by `round(t)`, clipped to a footwear zone box, unioned UNDER the shaped overlay. The skin can't poke through its own offset, and the overlap keeps the figure one component. Verified `isManifold: true`, `componentCount: 1` via `model:preview` on both a probe and the refactored superhero.

5. **Refactored `examples/figure_superhero.js`** to drop the hand-rolled `makeBoot` capsules for `F.clothing.boots(rig, { shaftZ })`. Its committed palette already keyed `boots`, so colors carried over. Rebaked `superhero.partwright.json` via `build-catalog-entry.cjs` under `xvfb-run -a` (headed Chromium needs an X server in the remote container) with `--palette-file public/catalog/palettes/superhero.json`.

Builders return unlabeled nodes (caller labels), consistent with every other part builder. Tests cover sole coverage, the boot shaft vs. shoe gap, turnout tracking, the posed-bone shaft projection, and option validation.
