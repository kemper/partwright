# frame_abdomen — session notes

## Verdict: CONVERGED (attempt 2, 6/6 MUST + 2/2 SHOULD, score 0.0585)

chamfer 0.0022 / hausdorff max 0.3429 (P99 0.0903) / IoU 0.9978 / volume ratio 1.0019.
Best candidate: `best/candidate.js` (from `work.js`). No optimizer run needed —
probed values landed inside every gate with margin.

## Measured structure (all numbers probed, none guessed)

Spine segment: waist socket at the bottom, chest ball on top.

- **Disc (belly plate)**: z-cylinder r=4.500 about the origin, z ±2.5, with
  45° leg-0.5 chamfers on the arc edges (r = 4.5 − (|z|−2) for |z| > 2;
  ray-verified at z 2.05..2.45).
- **Socket sphere**: r=2.8488 @ (0,0,0) — ray-verified from the cavity center
  at 3 angles (2.8487/2.8488/2.8488). NOTE: smaller than hip_shoulder's
  2.9075 — the kit socket radius is NOT one constant.
- **Entry cones (both z faces)**: r(z) = 2.3677 − 0.3525·(2.5−|z|). Slope
  consistent across 4 ray samples (0.3513–0.3529). Also NOT identical to the
  ankle/hip_shoulder spec (2.4709, 0.3678) — measure per part.
- **Mouth wedge**: vertical planes y = −0.6682·|x| through the socket center
  (same 0.6682 slope as hip_shoulder, mirrored; §5.12 confirmed again), with
  leg-0.5 45° chamfers near both z faces (plane recedes (|z|−2) along its
  normal for |z| ∈ [2, 2.5] — band-0 trace showed Δx = 0.9 = 0.5/0.5556).
- **Corner chamfer lines**: y = 0.2279·x − 2.9803 for x ∈ [3.3259, 3.9959]
  (and mirror) — hip_shoulder's exact numbers mirrored in y; the wedge∩line
  miter (±3.3259, −2.2223) IS the bbox ymin. Unchamfered, full z prism.
- **Bulge**: elliptical Y-prism, semi-axes (x=3.2, z=2.5), y ∈ [~2.5, 4.8],
  ending in a 45° chamfer to (3.0, 2.3) at y=5.0; submerges into the disc on
  the −y side (disc arc = 3.2 at y=3.164). Ellipse verified at 5 z-values
  (max dev ~0.005).
- **Body**: Y-cylinder r=3.000 (exact) to y=8.5, then 45° leg-0.5 chamfer to
  r=2.5 at the flat end face y=9.000. Clipped z ±2.5 (chord ±1.658 at faces,
  sharp edges — no chamfer there).
- **Neck**: D-section r=1.500 with a chordal flat at world z=−1.3
  (section area 6.8609 = circle 7.0686 − segment 0.2054, exact), y 9.0 →
  under the ball. Flat does NOT continue onto the ball.
- **Ball**: sphere r=3.000 exactly @ (0,13,0) (fit rms 0, inliers 1.0),
  clipped z ±2.5 like everything else. y_max = 16.0 = 13+3.

## Strategies tried

1. Deterministic slice-stack bootstrap → 0/6 MUST (score 2.78), 3 components.
2. Probe-driven primitive composition (above) → converged on attempt 2.
   Attempt 1 had two self-inflicted bugs: (a) subtracted the UNION of the two
   mouth half-space prisms instead of their INTERSECTION (carved both sides
   of the disc); (b) forgot the global |z| ≤ 2.5 clip, so the r=3 Y-cylinder
   poked to z=±3.

## What I'd try next (if reopened)

- Nothing needed for gates. Residual: 5.5mm² candidate excess skin, likely
  facet phasing on the r=4.5 arc (target ~160 segments vs SEG=128) and the
  hausdorff-max 0.34 probably sits at a chamfer-miter corner near
  (±3.3259, −2.2223) — could hull-miter per §5.19e if polish were required.
