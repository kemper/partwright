---
date: 2026-06-18
component: figure footwear (sdfFigure.ts buildFootwear)
---

## Human

In the catalog, several figures with shoes have defects: the heel juts out
behind the foot/leg (thought fixed before but still happening), the ballet
dancer looks like it has "bird feet", and the sprinter at the blocks has a heel
that comes out too far plus a giant foot that wraps around the sole of the shoe.
The sole was designed to "lock onto the ground" but works very poorly when the
shoe is NOT on the ground. Investigate the feet of several catalog figures
(especially the shod ones), propose a fix, implement if confident, and show
before/after previews.

## Assistant

Root cause (confirmed by git dates, not guesswork): `buildFootwear` was authored
2026-06-13 (`7a33a92`) sizing the shoe `last`/`heel`/coverage to a foot that
spanned ±0.86·footLen. The very next day (2026-06-14, `fbaa04f`/`d45c67b`) the
bare foot in `buildFeet` was reshaped — a SHORT heel just behind the ankle, the
length carried into the forefoot — but the footwear was never resized. So every
shoe ran ~1.7× the foot it wrapped: a long heel jutting behind the leg and a
club toe ("giant foot wrapping around the sole"). This hit both the flat
(ground-contact) path and the plantarflexed (lifted-foot) path, which is why the
problem was worst on lifted/posed shoes (sprinter lead foot, soccer kicking leg).

Fix — resize the shoe to the foot `buildFeet` actually makes, mirroring its own
landmarks (ankle at −0.12·footLen, heel ≈0.95·r.foot behind the ankle, toe at
+0.49·footLen), plus a thin wall and a small toe-spring:
- The `last` ellipsoid now spans the shoe heel↔toe (`shoeHeelY`..`shoeToeY`)
  instead of ±0.86·footLen, and the `heel` mass sits at the resized heel.
- The contrasting sole footprint (both paths) uses the same heel/toe extents.
- The guaranteed-coverage underlayer's heel offset was `0.38·footLen` behind the
  ankle (≈ the old long heel); corrected to `0.55·r.foot` so its cap lands just
  behind the real bare-foot heel (0.95·r.foot) instead of poking a phantom heel
  out behind the resized upper. The instep ellipsoid shrank 0.5→0.33·footLen.

Verified: shoe/foot length ratio dropped 1.69 → 1.27 (default rig); all 240
existing figure unit tests still pass (incl. the lifted-foot and boot-underside
enclosure probes, so coverage is still complete); added a regression test that
asserts the shoe is longer than the bare foot but < 1.4× it, so this drift can't
silently return. Before/after `model:preview` side views for the sprinter,
superhero (boots) and soccer striker show the clown-shoe/heel-jut gone.

The bare-foot ballerina "bird feet" is mostly the pedestal base swallowing the
supporting foot plus a small plantarflexed arabesque foot — the feet are fine in
isolation; the shod figures were the real defect, matching the user's note.

Catalog `.partwright.json` entries store baked geometry, so the 14 shod entries
are re-baked separately to surface the fix in the catalog grid.
