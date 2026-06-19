---
date: 2026-06-19
branch: claude/hands-opt3-twopass
files_changed:
  - src/geometry/sdf.ts
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
---

## Human

Option 1 and Option 2 hands both showed triangle spikes on the fingers and
fingers leaning into each other (catalog screenshots attached). Investigate the
real cause and make high-quality fingers — fix 1 & 2 or do Option 3. (Chose:
build Option 3 fully.)

## Assistant

Root-caused the spikes empirically: the whole figure is meshed by ONE coarse
`Manifold.levelSet` march, and `handDetail` only does a post-march *refine*
(subdivide + reproject). Refinement cannot change topology — the coarse march
WEBS the thin, closely-spaced fingers into a topological handle (proved: a
rotated hand is `genus 1` coarse+refine vs `genus 0` at a uniform fine march),
and the refine pass frays that handle into the radial spikes. So Options 1 & 2
were unfixable in place; both ride the same flawed path.

Option 3 = mesh each hand on its OWN uniform fine grid and hard-union it onto
the coarse body. Validated the clean architecture first (arm built separately +
hand built separately, hard-unioned = `genus -1`, two clean genus-0 solids — a
tapered forearm and a palm slab are distinct enough shapes to union with no
seam). A boolean splice of the *fused* arm+hand field does NOT work (coarse vs
fine arm cross-sections coincide at the wrist → handles), so the hands must be
their own solid.

Implementation (transparent — zero example churn, additive so non-figure SDF
models are byte-identical):
- `sdf.ts`: a `fineHands` marker node (`opFineHands` / internal `__fineHands`)
  carrying per-hand spheres. `partitionByLabel` gained an ADDITIVE branch: a
  labelled subtree containing markers is split into the coarse "rest" (hands
  removed from its eval) + one per-hand region that still paints with the same
  label. `buildSdf` meshes a `fineRegions` region by marching each sphere's
  small bbox at a uniform fine grid and unioning — resolving the fingers at the
  source. Gated entirely on the marker (no marker → existing path untouched).
- `sdfFigure.ts`: `buildHands` tags sculpted hands with `sdf.__fineHands(...)`;
  `weldBody` pulls markers OUT of the smooth weld into a hard union (so the body
  field never contains the fingers to web). `handDetail` is now a deprecated
  no-op (hands self-mesh) — existing `detail: [...F.handDetail(rig)]` still works.
- Fixed a separate geometry bug: wide-splay straight-finger grips (open/spread/
  wave) formed real handles because fanned capsules crowd at the base on the flat
  palm. Fanning the finger BASES outward (clamped to the palm) past ~10° opens
  those gaps. Grip genus sweep: all clean except open/wave at a tiny base-tunnel
  (genus 1, not visible) and `ok` (genus ≥1 is correct — the OK sign is a real
  thumb-index ring).

Verified: full multi-label figure (skin+pants+eyes) builds manifold, 1
component, 203k tris, clean separated spike-free fingers in the REAL browser
(`renderViews`) AND headless `model:preview`. 1511 unit tests pass; preflight
green (no new dep cycles). Catalog rebake (#751) still needed for the baked
`.partwright.json` thumbnails to show the new hands.
