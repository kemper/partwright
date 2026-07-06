# frame_hip_and_shoulder_4x — session notes

## Verdict: CONVERGED (attempt 1, 6/6 MUST + 2/2 SHOULD, score 0.0898)

chamfer 0.0039 / hausdorff max 0.2957 (P99 0.1195) / IoU 0.9948 / volume ratio 1.003.
Best candidate: `best/candidate.js` (from `work.js`).

## Measured structure (all numbers probed, none guessed)

- **Socket sphere**: r=2.9075 @ (0, 0.002, 2.5), inliers 0.988 (Dummy 13 Ø6
  joint spec minus fit clearance; probe fit, tactic 5.2).
- **Rim entry cones (both faces, tactic 5.10)**: r(z) = 2.4709 − 0.3678·z
  from z=0, mirrored at z=5. Nearly identical to frame_ankle's cone
  (2.465, 0.371) → this is the kit-wide socket lead-in spec.
- **Mouth wedge**: vertical planes y = ±0.6682·x passing exactly through the
  socket center (tactic 5.12 coincidence confirmed), full height.
- **Main block outline** (z∈[0,5]): walls x=±4.5 for y∈[−2.8,0], then an arc
  of **r=4.500 about the socket center** (NOT a flat wall + corner fillet —
  the bootstrap's DP trace disguised it), then a straight corner chamfer line
  y = −0.2279x + 2.9803 from (3.9959,2.0696) to (3.3259,2.2223) on the mouth
  line; bottom: y=−2.8 edges + 45° corner cuts (3.7,−2.8)→(2.5,−4), y=−4.
- **Tab**: x∈±2.5, y∈[−5,−4], z∈[0,5], with leg-1.0 45° chamfers on all four
  horizontal x-edges (ray-measured z = 6.5 − x). End face y=−5 unchamfered.
- **Rod**: cylinder r=1.500 (exact, rms 0) along Y at z=2.5, y −7.6..−5.
- **Rear block**: cylinder r=2.9995 along Y at z=2.5, y∈[−9.9,−7.6], clipped
  flat at z=0 (section area 27.14 matches clipped circle to 0.01mm²).
- **Outer 45° leg-0.5 top+bottom chamfers ONLY on**: x=±4.5 walls, the r=4.5
  arc, and the mouth lines. NOT on: y=−2.8 edges, corner cuts, y=−4 edge,
  tab end, chamfer-line edges, rear cylinder (verified via z=0.05 contour).
  Built exactly per §5.11 (wedge prisms + a 45°-cone annulus cutter about the
  socket center for the arc, sector-limited) — no staircase.

## Strategies tried

1. Deterministic slice-stack bootstrap → 2/6 MUST, silhouette-limited.
2. Probe-driven primitive composition (above) → converged in one edit.

## What I'd try next (if reopened)

- `optimize.mjs` over the declared params (socketR, rimR0, rimSlope, mouthS,
  outerR, rearR, cham) — not run since all gates pass with margin; probed
  values appear already-optimal.
- The only residual signed skin is 9.4mm² candidate excess (likely facet
  phase on the r=4.5 arc / rear cylinder) — cosmetic at this scale.
