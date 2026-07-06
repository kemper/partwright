# frame_chest — session notes

## Verdict: CONVERGED (attempt 1, 6/6 MUST + 2/2 SHOULD, score 0.1683)

chamfer 0.0067 / hausdorff max 0.3529 (P99 0.2081) / IoU 0.9927 / volume
ratio 1.0036 / area ratio 1.0119. Best candidate: `best/candidate.js`
(from `work.js`). One authored attempt after the bootstrap.

## Measured structure (all numbers probed, none guessed)

The chest is TWO copies of the hip_shoulder socket module + the hips ball
archetype, joined by a plate. Grammar transferred verbatim; radii re-measured
per part (they differ!):

- **Shoulder balls**: r=3.000 EXACT at (±6, 14, 0), rms 0, inliers 1.0.
  Ball tops give bbox zmax=3; everything else spans z ∈ [−2.5, 2.5].
- **Spine socket** (opens −y): sphere r=2.8501 @ (0,0,0) (rms 0.0026) —
  SMALLER than the kit's usual 2.90. Rim cones r0=2.372 (measured from
  z=2.45/2.25 sections: r 2.35/2.28), slope 0.3678, both faces.
- **Neck socket** (opens +y): sphere r=2.900 EXACT @ (0,20,0) (rms 0), rim
  cones r0=2.4709 (the hip_shoulder value exactly), slope 0.3678, both faces.
- **Both socket blocks** = hip_shoulder outline mirrored/translated: arc
  r=4.500 about the socket center, mouth wedge y = ∓0.6682|x| through the
  center (§5.12), corner chamfer line A=0.2279 B=2.9803 (endpoints r4.0 on
  mouth line, r4.5 on arc). Spine block walls x=±4.5 tangent at y=0.
- **Plate**: column x±4.5 y 0..7 + bar octagon x±8 y 7..10 (plan corner
  chamfers 0.5), slot 3.0×3.2 @ (0, 6.5) (genus hole 1), wall notches
  y∈[3,3.5] from x=±4.5 to ±3.25 with r0.25 rounded end (NOT chamfered).
- **Struts**: cylinder r=1.5 along Y at (x=±6, z=0) from bar into ball, with
  the hips-style chordal flat at z=−1.3 (ray: bottom hit −1.3, top 1.4993).
  Flat cut on the strut member BEFORE union.
- **Arms**: prismatic slabs z ∈ [−1.5, 1.5] (ray-exact) between plan lines
  x+y=20 and x+y=22.5 (both verified at two z's), ring→ball. Central opening
  bounded by bar y=10 / struts / balls / arms / ring = genus hole 2.
- **Outer 45° leg-0.5 chamfers on BOTH faces** (z=±2.45 sections have
  identical contours): walls, both r4.5 arcs (annulus cutters, neck = full
  annulus minus wedge sector), mouth lines, corner lines, all bar edges +
  plan corners, y=10, slot rim (exact hull frustums, outer faces pinned on
  z=2.0/2.5 planes). NOT chamfered: notch edges, arms, struts.

## Strategies tried

1. Deterministic slice-stack bootstrap → 2/6 MUST (score 2.14), silhouette.
2. Probe-driven primitive composition (above) → converged in one edit.

## Residual (cosmetic, both SHOULD pass)

F1/F2: symmetric ~1.0mm³ excess thin-skin over the neck ring at z≈±2.25
(extent 9×6.4×0.5). Likely the ring's face chamfer is slightly wider than
leg 0.5 near the mouth, or the cone lead-in blends differently. Optimizer
over (r0n, slope, cham) is the next move if reopened; not run since all
gates pass with margin.
