# adapter_stand — session notes

## Verdict: CONVERGED (attempt 1, phase done)

Score 0.0088 | chamfer 0.0008 | hausdorff max 0.069 / P99 0.0074 | IoU 0.9991 |
volume ratio 1.0005 | genus 1/1, components 1/1 | 6/6 MUST + 2/2 SHOULD.
Best candidate: `best/candidate.js` (attempt 001). One turn used.

## What the part is

Keyhole hanger, revolved body about the Y axis at (x=0, z=2.5), clipped flat
at z=0 (print bed):

- **Ball**: sphere r=3.000 @ (0, -5.5, 2.5) — probe fit rms 0, inlierFrac 1.0 (exact).
- **Neck**: NOT cones and NOT a single fillet arc. r(y) is a concave curve that
  accelerates toward the flange; a least-squares circle fit had worst residual
  0.05 and could not reach the flange face — rejected. Modeled as a traced
  polyline: band circle fits (`bands --axis y --step 0.1`, rms < 0.001, all
  centered cy=2.500) for r ≤ 2.54, then back-face rays (`ray --from x,-3.5,2.5
  --dir 0,1,0`) for r 2.6→4.0. Waist min r=1.6078 at y≈-2.70. Ball surface holds
  until y≈-3.05. Neck reaches r=4.0 exactly at y=-1.0 (curved back face, no
  flat annulus).
- **Flange**: disc r=4.0, rim y ∈ [-1, 0], flat front face at y=0.
- **Keyhole loop** (the genus-1 hole): prismatic in z (verified sections at
  z=0.3/2.7/2.95 identical), extruded z ∈ [0, 3]. Cross-section: outer =
  circle R=1.4997 @ (0, 2.1) + straight-sided foot x=±1.2 down to the flange
  face (circle half-width equals 1.2 exactly at y=1.2 — tangent joint); inner
  void = circle r=0.6592 @ (0, 2.1) + slot x=±0.36 down to y=0. Loop tip
  y=3.6 = 2.1 + 1.4997.

## Strategies tried

1. Bootstrap slice-stack (auto): 4.23, 0/6 — staircased bands, genus -2, 3 components.
2. Revolved traced r(y) polyline + probed loop: converged first try. No
   optimizer pass needed — every number came from probe (fit/bands/ray/section),
   and the gates passed with margin, so `api.params` was never declared.

## What I'd try next (if reopened)

Nothing needed. If chamfer polish were ever demanded: the only visible skin
excess is 0.6mm² (probably the small kink where the ball arc hands off to the
first neck sample at y=-3.048, and the 128-segment revolve facets). Densify
the ball-arc sampling near the transition or bump revolve segments.

## Prior-session note

The old v1 candidate (`.plans/inverse-cad/candidates/adapter_stand-v2.js`,
"ball + cones + stadium loop") was directionally right about topology but
wrong about the neck (straight cones — the real profile is concave) and the
loop cross-section (stadium — really circle+foot / circle+slot). Its 0.097
chamfer would NOT have passed this framework's gates without the same
restructure.
