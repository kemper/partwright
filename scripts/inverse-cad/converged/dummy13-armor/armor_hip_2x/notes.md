# armor_hip_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 1: **score 0.0496**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0024mm,
hausdorff max 0.0924mm (P99 0.0444), IoU 0.9950, volume ratio 0.9992
(345.4 vs 345.7mm³), genus 0/0, components 1/1, zero findings. ONE authored
attempt (budget 15). Best candidate: `best/candidate.js`
(= genLevelSet output, `--step 0.1 --dp 0.02 --edge 0.1`).

## Method

§5.25 levelSet section interpolation, stock `genLevelSet.mjs`, zero hand
edits. The facet census (§5.26) was run first and steered the strategy: 3194
tris resolve to 1851 distinct planes — NOT a pure faceted-exact part like
armor_upper_arm (520 tris / 109 planes). The census showed several curved
fans plus a 45° curved-erosion band, so the exact hull/half-space decode
would have been a long campaign; levelSet took it in one turn.

## What the part actually is (from census + sections, if anyone wants the exact CSG)

Arch-shaped hip cap, mirror-symmetric in x, 12 × 8 × 10.8, sitting Z-flat.

- **Base block** z 0..4.8: plan x±6 / y −4..4 with 45° plan corner cuts
  (x∓y=8 rear pair, x±y=9 front pair, all full height 0..4.8).
- **Outer arch** above z=4.8: y-axis cylinder-fan tangent planes
  ((±0.803,0,0.596)-family etc.), crown at z=10.8.
- **Rear curved 45° bevel** (the striking census feature): a whole family of
  ny=−0.707 planes with nx²+nz²=0.5 — for y∈[−4,−2] the section equals the
  full XZ profile INSET linearly by (−2−y) (verified: section bboxes at
  y=−3.9/−3.0 match inset 1.9/1.0 exactly). A linear erosion band, not a
  prism along any axis — this is what makes levelSet the right tool.
- **Cavity**: arch tunnel opening at y=+4, back wall y=−2.1 (z 0..9.15);
  floor z=0.8 with 45° wall chamfers (x±z=2.95-family); lower walls x=±4.75
  (z 1.8..4.8) continuing into an inner y-axis cylinder fan up to z≈8.13;
  bottom through-slot |x|≤2.6 for z<0.8 (with 45° plan chamfers x+y=−3.7
  family down to (±1.6,−2.1)).
- **Crown slot**: |x|≤2.49, z above ≈8.14, back wall y=−1.2 (z 8.14..10.8),
  tilted sloped roofs (±0.781,0,−0.625) d=−7.7228, plus a tilted front top
  face (0,0.375,0.927) d=9.637 (y −0.39..2.375).
- **Ball-clearance scoop** in the y=−2.1 cavity back wall: a shallow dish
  around x=0, z 1.4..6.66, max depth to y=−2.69 at z≈4.6 (bootstrap band
  traces show it as a bump at z 3.875/4.625/5.5). Never probed as a sphere —
  levelSet reproduced it from sections; fit it if an exact CSG is wanted.
- Back face y=−4 (z 0..8.8), front face y=4 small (z 0..8.37), crown step at
  x≈0: z=9.55 shelf y −1.7..−1.2 with a 45° chamfer from (−2.1, 9.15).

## Strategies tried

1. Deterministic z-band slice-stack bootstrap → 1/6 MUST, score 2.15.
2. genLevelSet z-blend, 108 sections @ 0.1mm, dp 0.02, edge 0.1 → 6/6+2/2,
   score 0.0496, in ONE turn. No straddle-pair ledge sections needed: the
   sharp z-ledges (floor z=0.8, slot floor ≈8.14, shelf z=9.55) smear at most
   one 0.1mm pitch, which stayed under every gate with margin.

## What I'd try next (if reopened)

- Nothing required. If someone wants CAD-pure parametric code, the exact CSG
  spec above is ~90% of the decode; remaining measurements: exact outer/inner
  arch fan radii+centers (fit tangent-plane fans per §5.29-style algebra) and
  the ball-scoop sphere (`probe fit --near 0,-2.7,4.6 --r 2`).
- If chamfer polish were ever demanded: insert straddle section pairs at
  z = 0.8, ≈8.142, 9.55 (±0.005) — requires converting the generated sdf's
  uniform-step band index to a binary search over a non-uniform section list.
