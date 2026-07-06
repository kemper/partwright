# armor_head — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 1: **score 0.0964**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0048mm,
hausdorff max 0.1284mm (P99 0.074), IoU 0.9957, volume ratio 1.0000
(1422.1 vs 1422.1mm³), genus 0/0, components 1/1. ONE authored attempt
(budget 12). Best candidate: `best/candidate.js`
(= stock genLevelSet output, `--step 0.1 --dp 0.02 --edge 0.1`).

Residual findings (all passing, thin-skin): F1 1.6mm³ @ z≈10.41, F2 0.8mm³
@ z≈1.13, F3 0.6mm³ @ z≈9.74 — the levelSet 0.1mm blend smear at the
interior flat ledges z=10.45 / z=1.05 and the 45° chamfer break z=9.0. If
someone ever wants them gone: straddle-pair sections at those z (§5.25,
requires non-uniform section support in the generated sdf).

## Method

§5.26 facet census first: 2278 tris → 1394 distinct planes (> tris/2) —
no faceted-exact collapse; curved fans present. §5.22 volume test reads
50.5% of bbox (borderline prism-minus-cavity), but the census shows the
"cavity" walls carry 45° chamfer families and tilted faces, not clean
cross-prisms — §5.26a plane-count discriminator wins: went straight to
§5.25 stock genLevelSet, zero hand edits, one turn.

## Structure map (from census, if anyone wants exact CSG)

Helmet, z-mirror-symmetric about z=5.75 (every top plane has a bottom
twin), Z-flat, 14 × 17.5 × 11.5. NOT x-mirror-symmetric (asymmetric visor).
- Flat top/bottom z=11.5 / z=0 caps (82mm² each, x±4.5, y±6.25).
- Slanted near-vertical face n=(0.996,−0.087,0) d=6.8475 on +x; big 45°
  top/bottom chamfer pairs n=(0.704,−0.062,±0.707), n=(0,−0.707,±0.707),
  n=(−0.5,−0.5,±0.707); front face y=−8.75 (x 2.2..5.6, z 2.5..9).
- Interior cavity: back wall x=1.7 (y −8.25..6.45, z 1.55..9.95) with
  ceiling/floor ledges z=10.45 / z=1.05, chamfered into the wall by
  n=(∓0.707,0,±0.707) pairs; corner bevels n=(−0.653,−0.653,±0.383).
- Rear pocket: x=−3.5 wall (z 1.55..9.95) and a smaller x=−1.5 wall with
  z=7.15/4.35 ledges, y=6.45 and y=2.25 walls — a stepped rear slot.
- 45° plan wall n=(0.707,−0.707,0) d=−0.6011 (x −4.15..−3.0, full height)
  and y=−3.296 face at x≈−4.5: the left cheek block.

## Strategies tried

1. Deterministic bootstrap (silhouette) → 1/6 MUST, score 3.43.
2. Facet census (discriminator only, no decode attempted).
3. genLevelSet z-blend @ step 0.1 / dp 0.02 / edge 0.1 → 6/6+2/2, score
   0.0964, ONE turn. No straddle pairs needed.

## What I'd try next (if reopened)

Nothing required. Straddle pairs at z=1.05/10.45 would shave the last
thin-skin findings if chamfer polish were ever demanded.
