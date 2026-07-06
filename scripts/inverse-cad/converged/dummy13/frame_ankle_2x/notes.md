
## Session 2026-07-03 — CONVERGED (attempt 2, score 0.0450)

**Final: 6/6 MUST, 2/2 SHOULD.** chamfer 0.0026mm, hausdorff max 0.1185mm,
volume IoU 0.9949, volume ratio 1.0004, area ratio 1.0011. Best = attempt 2.

### What converged
Full CAD decomposition (best/candidate.js), all numbers probed:
- Ring: disk r=4.5 @ [0,0], cut by {y>=-4}, {y<=2.96} (left tip), right tip
  chord through [4.3733,1.0605]-[3.7588,1.3681], and a mouth wedge (pie cut)
  with apex at the SOCKET center, rays at 20.03deg and 132.5deg — both mouth
  cut lines pass exactly through the socket center (verified from two traced
  points each at two z heights).
- All ring face edges carry a 45deg 0.5x0.5 chamfer (measured: bbox inset is
  exactly 0.5 - z, and inset lines of the wedge/tip cuts at z=0.05 match the
  0.45 perpendicular offset to <0.01). Chamfer is ring-only: lobe/neck/keyhole
  are unchamfered full-height prisms (lobe ymin stays -7.0 at z=0.05).
- Neck rect x∈[±1.2] y∈[-4.65,-3.9] + lobe disk r=1.5 @ (0,-5.5); keyhole
  through-hole kept as the traced 13-pt polygon (verified prismatic: identical
  at z=0.05 and z=2.0).
- Socket = sphere r=2.9046 @ [0.0008,-0.0015,2.5] (probe fit, 99.1% inliers)
  PLUS two conical entry chamfers: cavity radius measured linear
  r(z)=2.4649-0.3708z from each face, meeting the sphere at z≈0.64/4.36
  (~20deg from vertical — NOT 45deg). Without the cones the cavity rim is
  wrong from z=0..0.65 on both faces.
- Chamfer realization: attempt 1 used stepped 2D offsets (5x0.1) — passed all
  MUST but failed area ratio 1.0505 (a staircase carries sqrt2 x the area of
  the true 45deg face; ~+16mm² over the chamfer band = the whole +5%).
  Attempt 2 replaced it with exact geometry: cone-cyl-cone intersection
  envelope for the arc + one 45deg halfspace wedge prism per straight edge
  per face (10 subtractions), each limited in extent along its edge so the
  runout at the neck (|x|<1.2, where the y=-4 chamfer stops) is respected.

### What's left / next
Nothing required — all gates pass. Sub-0.1mm³ residuals if anyone wants
polish: (a) arm-tip corner detail (target ymax at z=0.05 is 2.6254 vs 2.51
for a pure miter corner — some small corner blend at the tip, ~0.08mm³);
(b) neck-runout blend is a diagonal in the target ([1.2,-3.87]->[1.9,-3.57]
at z=0.05), modeled as a hard stop (~0.2mm³). optimize.mjs was not needed:
probed dimensions landed volume ratio 1.0004 directly.

### Strategies tried
See state.json strategiesTried. Do NOT re-attempt slice-stacking; the part is
fully CAD-decomposable.
