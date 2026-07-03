## Session 2026-07-03 — CONVERGED (attempt 1, one authored candidate)

Final: 6/6 MUST, 2/2 SHOULD. score 0.0052, chamfer 0.0005, hausdorff max 0.0864,
P99 0.0017, IoU 0.9992, volume ratio 1.000.

Structure (all numbers probed, zero guesses):
- 3 balls: `probe fit` returned sphere r=3.000 exactly at (-8,0,0), (0,0,0), (8,0,0),
  rms 0, inlierFrac 1.0 — the §5.18 limb-ball archetype (r=3.000 exact) holds on hips.
- Strut: cylinder r=1.500 axis +X (rms 0, inliers 1.0), x spanning the end-ball
  centers, with a chordal FLAT at z=-1.3 (§5.19: section bbox z-min -1.3 beat the
  circle's -1.5; segment-area math matched measured 6.8602mm² to 0.006).
- Whole part bottom-clipped at z=-2.5 (bbox zmin; z=-2.48 section showed 3 circles
  r=1.6867 = sqrt(9-2.48^2) exactly — spheres run uncut to the clip plane).
- Ball centers at z=0, NOT bbox-center z=0.25 — the 0.25 offset is an artifact of
  the asymmetric bottom clip. v1 candidate's z+0.25 translate was wrong; its strut
  r=1.3 round section was also wrong (real: r=1.5 with D-flat).
- Order matters: flat cut on the strut BEFORE union (balls are not flattened at
  -1.3); bottom clip on the ASSEMBLED body.

Strategies tried: probed-primitives composition (spheres + D-prism strut + clip) —
worked first try. Bootstrap slice-stack scaffold discarded wholesale (5/6 bands
STAIRCASED on the spheres, as expected).

Nothing left to try; no optimizer pass needed (probe fits were exact, rms 0).
