# frame_forearm_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 1: **score 0.0038**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0005mm,
hausdorff max 0.0943mm, P99 0.0029mm, IoU 0.9996, volume ratio 0.9995,
genus 1/1, components 1/1, zero findings. 1 authored attempt (budget 15) —
single measured restructure over the bootstrap, via §5.18 sibling transfer
from frame_shin_2x.

## What the part actually is (all numbers verified against THIS target)

A shortened frame_shin_2x — identical architecture, only the Y positions
rescaled. Y-long, z-flat, bbox 6 × 20.5 × 5.5. Genus 1 (window only).

- **−Y end = elbow ball**: sphere r3.000 c(0, −15, 2.5) — probe fit rms 0,
  inliers 1.0. Clipped flat at z=0 by the build plate (would reach z=−0.5).
- **Neck**: Y-prism (authored −13..−11; ball overtakes neck at y ≤ −12.4) of
  the same D-profile: circle r1.5 c(0,2.5), flat bottom cut at z=1.2.
  Verified by band-area chord math: measured 6.8605 vs analytic D-segment
  area 6.8664.
- **Shaft end face** at y=−11.0 with the 0.5 × 45° perimeter chamfer
  (hull of pinned slabs, octSmall at −11 → oct(2.5) at −10.5).
- **Shaft**: chamfered octagon 5×5 (hw 2.5, 0.5 chamfers), y −10.5..0.
- **Window** (the genus handle): slab void z 1.0..4.1 from shaft face
  y=−5.000 past the spool (slab y −5..3.5). Verified: bridge-pair section
  area 9.00 measured == 9.00 analytic exact (oct(2.5) minus z 1.0..4.1).
- **+Y end = wrist spool** at (0,0): identical to the shin/thigh spool —
  r2.5, 45° V-groove to r1.5 at z=2.5 (groove z 1.5..3.5), 0.5 chamfers at
  z0/z5 faces (r2.0), truncated-cone dimples r1.0→r0.5 depth 0.5 both
  faces, subtracted LAST. Verified: z=0.25 section hole = circle r0.75
  c(0,0) (area 1.7646 vs π·0.5625 = 1.7671); y-band contour split into 2
  exactly for |y| in 1.5..2.5 (groove r1.5 / outer r2.5).

## Probes used (3 total + bootstrap traces)

1. `fit --near 0,-15,2.5 --r 3.2` → sphere exact.
2. `bands --axis y` + `bands --axis z` → whole segmentation; every borrowed
   shin number checked by chord/area math against the band table before
   authoring (§5.18 discipline).
3. `section --axis z --at 0.25` → dimple radius confirmation.

## strategiesTried

- sibling-transfer-from-shin (§5.18) — SUCCEEDED, attempt 1.

## Not done / next if reopened

- Nothing structural. Optimizer pass skipped deliberately: every dimension
  is an exact probe fit / chord-math match; chamfer 0.0005 leaves no
  numeric headroom.
- Candidate = best/candidate.js (also attempts/001). Fully parametric
  CAD-style code, no traced point dumps.
- For frame_upper_arm_2x (if it exists as a sibling): expect the same
  archetype again — check ball center = ymin+3, spool at ymax−2.5, and
  reuse the shin/forearm feature specs with the same chord-math checks.
