# Dummy 13 — converged parametric reconstructions (framework v2)

All 21 CC-BY-4.0 Dummy 13 parts (soozafone) reconstructed as parametric
manifold-js code by the inverse-CAD v2 loop (`scripts/inverse-cad/`,
PLAYBOOK.md), each passing **every MUST acceptance gate** (topology match,
hausdorff P99 ≤ 0.4mm, volume IoU ≥ 0.95, no error blob > 4mm³, volume
±2%) against its source STL. Verified with exact point→triangle signed
distance — no sampling noise floor.

| part | chamfer (mm) | hausdorff max | volume IoU | authored turns |
|------|-------------:|--------------:|-----------:|---------------:|
| adapter_stand | 0.0008 | 0.069 | 0.9991 | 1 |
| frame_abdomen | 0.0022 | 0.343 | 0.9978 | 2 |
| frame_ankle_2x | 0.0026 | 0.119 | 0.9949 | 2 |
| frame_chest | 0.0067 | 0.353 | 0.9927 | 1 |
| frame_clavicle_2x | 0.0009 | 0.048 | 0.9990 | 1 |
| frame_forearm_2x | 0.0005 | 0.094 | 0.9996 | 1 |
| frame_head | 0.0031 | 0.122 | 0.9938 | 2 |
| frame_hip_and_shoulder_4x | 0.0039 | 0.296 | 0.9948 | 1 |
| frame_hips | 0.0005 | 0.086 | 0.9992 | 1 |
| frame_knee_and_elbow_4x | 0.0034 | 0.046 | 0.9964 | 4 |
| frame_neck | 0.0004 | 0.003 | 0.9995 | 1 |
| frame_shin_2x | 0.0003 | 0.091 | 0.9998 | 1 |
| frame_thigh_2x | 0.0013 | 0.086 | 0.9978 | 7 |
| frame_upper_arm_2x | 0.0017 | 0.087 | 0.9982 | 1 |
| frame_waist | 0.0009 | 0.089 | 0.9991 | 1 |
| hand_fist_left | 0.0216 | 0.739 | 0.9762 | 3 |
| hand_fist_right | 0.0217 | 0.683 | 0.9760 | 1 |
| hand_grip_left | 0.0284 | 0.287 | 0.9556 | 7 |
| hand_grip_right | 0.0282 | 0.288 | 0.9550 | 2 |
| hand_open_left | 0.0235 | 0.198 | 0.9635 | 1 |
| hand_open_right | 0.0234 | 0.198 | 0.9631 | 1 |

**Mean chamfer 0.0083mm, worst 0.0284mm.** 15/21 parts also pass both
advisory SHOULD gates; the six hands miss only area-ratio (band-staircase
riser area — a documented modeling-style limit, not a shape error).

Per part: `candidate.js` (the parametric reconstruction — runs in the
Partwright manifold-js sandbox), `metrics.json` (full gate evaluation),
`notes.md` (measured dimensions + design-intent findings — the reference
for the Phase C `src/geometry/dummy13.ts` rebuild), `state.json` (attempt
history). Source STLs: `.plans/inverse-cad/target-stls/` (CC-BY-4.0,
soozafone). To re-verify any part:

```bash
node scripts/inverse-cad/eval.mjs .plans/inverse-cad/target-stls/<part>.stl \
  scripts/inverse-cad/converged/dummy13/<part>/candidate.js
```

Kit-wide design intent discovered during convergence (details in
PLAYBOOK.md kit notes): joint balls are r=3.000 exactly everywhere; socket
radii are deliberately per-part (2.85–2.91); the mouth-wedge slope
(0.668|x|) and corner-chamfer line (y=±(0.228x−2.980)) repeat across five
socket parts; socket lead-in cones ≈20° on every open face.
