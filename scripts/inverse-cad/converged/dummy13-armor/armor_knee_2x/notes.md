# armor_knee_2x — verdict

**CONVERGED (bit-exact), attempt 1.** 6/6 MUST + 2/2 SHOULD, score 0.0000,
chamfer 0, hausdorff 0, IoU 1.0000.

Strategy: §5.26 facet census (440 tris -> 96 planes + 222 welded verts) —
the whole part decoded in one census, zero fit probes.

Structure:
- Outer body is CONVEX (§5.27): `Manifold.hull` of the 40 exact welded outer
  vertices (decagon plan: end faces y=±5 |x|<=1, corner cuts to (±1.6213,
  ±4.5149), tapered side walls x = 2.75 - 0.25|y|, straight walls x=±2.5 for
  |y|<=1; roof: flat z=3 |y|<=1, slopes z = 3.375 - 0.375|y|, steeper end
  slopes 1.443 down to z=1 at y=±5, 45° x+z=5 chamfers, corner slant planes
  n=(0.6585,0.4030,0.6356) d=3.6179).
- Minus one X-axis cavity prism (x -1.6..1.6, open at z=0 only): cross-section
  = polygonized circle r=1.5 centered (y=0, z=1) + tangent tent to apex
  (0, 1+sqrt(3)) (tangent lines at 30° slope) + a bottom flare from the exact
  circle point y=±1.3 (z=0.25167) out to y=±1.367 at z=0. Polygon points
  hardcoded verbatim from the welded vertex list (float32-exact), extended
  -0.5 below z=0 keeping the flare edge endpoints, extrude + rotate([90,0,90]).

What did NOT work: nothing — first authored attempt landed.
Next if reopened: nothing; converged code is in best/candidate.js.
