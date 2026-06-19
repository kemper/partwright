---
date: "2026-06-19T00:00:00Z"
task: "feat: four-finger flat-palm hands for figures"
pr: 748
areas: [geometry, figures, verification]
cost: high
---

## Liked / Worked
- `model:preview` with multi-angle `--view "az,el;..."` (palm/back/top-down/iso in one call) made hand iteration fast, and the topographic-prominence reach-peak counter turned "how many fingers?" into a robust unit test.
- Prototyping the geometry in a self-contained `.plans/*.js` snippet (canonical axis-aligned frame) let me sweep variants and montage them for the user WITHOUT touching `buildHands` — got the user's pick before wiring anything in.
- The work-reviewer pass on the first version was genuinely clean *for what it checked* — the bug it couldn't catch was a resolution mismatch, not a code defect.

## Lacked
- I verified the first rework at a FINE preview edgeLength (0.18) and shipped it; the **catalog bakes coarse** (detail sphere marches at ~`r.hand*0.085`), so thin fingers/palm aliased into craters and corrupted fingers that only showed up when the user looked at the actual catalog. Two full review cycles lost.
- Nothing in the headless tooling flags "this feature will be consumed at a coarser resolution than you're previewing at." The `model:preview` default (`edgeLength R*0.08`) is finer than the real catalog bake of the same part.

## Learned
- **Verify at the resolution the artifact is actually consumed at, not the finest one that looks good.** For figure parts that's the catalog bake's detail-sphere edgeLength (~`r.hand*0.085`), not a 0.18 preview. Keep feature radii ≥ ~2.5–3× that march edge or they alias away (old fr=0.24·r.hand survived; my 0.155 didn't).
- To flatten an SDF along an ARBITRARY axis without a non-uniform scale: intersect with a thin rounded slab oriented by `eulerAlignZ(axis)` (roll is irrelevant for a square slab). Flatten the *palm only*, not curl-posed fingers, or the slab slices the tips.
- The rig's `elbowHinge` is NOT X-mirrored, so any off-centre finger profile needs the splay × `side` trick for L/R symmetry.

## Longed for
- A `model:preview --as-catalog` (or a documented "bake-faithful" edgeLength) so a part is previewed at the SAME march density the catalog/figure build will use — this single flag would have caught the crater bug in the first pass.
- A cheap "does this figure part survive its detail-sphere edgeLength?" lint: warn when an additive feature's radius is < ~3× the local march edge.
