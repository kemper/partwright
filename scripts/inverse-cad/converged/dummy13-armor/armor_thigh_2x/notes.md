# armor_thigh_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 4: **score 0.0180**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0010mm,
hausdorff max 0.0389 / P99 0.0177, IoU 0.9984, volume ratio 1.0011,
genus 1/1, components 1/1, zero findings. 4 attempts used (budget 15;
attempt 1 was already 6/6+2/2 at 0.1517 — attempts 2-4 chased the mouth
chamfer detail).

## What the part actually is (all numbers ray-probed, not guessed)

A thin armor SLEEVE that slides over the frame thigh (closed octagonal ring
section at the bottom, opening up toward the knee). Genus 1 = the sleeve tube
itself (bottom mouth ↔ front opening); the visible "eye" at the top is an
OPEN notch (merges with the top gap), not a closed handle.

- **Plan section**: rect x ±4.5, y ±6 with 45° corner cuts of width 2
  (inner endpoints at x=±2.5 on each wall; cuts SHEAR with the walls:
  x±y ≤ 2.5 + wall(z)).
- **Front wall**: single plane y = 6.60606 − 0.151515·z starting at z=4
  (y=6 below). The clip TAB (x ±1.5, corner cuts |x|+y+0.151515z ≤ 7.60606)
  is the SAME plane continuing; tab top = flat z 17.25 + chamfer facet
  through (y 3.4918, z 17.25)→(y 4.0672, z 16.757).
- **Back wall**: circular arc in (y,z): center (z=3.9973, y=75.2877),
  r=81.2869, rms 4e-4 — tangent to y=−6 exactly at z=4 (both walls "start"
  at z=4; design intent). Back corner cuts are this arc SHEARED 45°.
- **Front scoop** (X-prism cut): 45° entry line y = 13.423−z, blend arc
  center (z 13.4979, y 6.9876) r 4.9924 (tangent to both lines, rms 3e-4),
  exit plane y = 1.33001 + 0.048749·z.
- **Knee-pivot cluster — everything at the top references axis X through
  (y=0, z=22)**: notch floor = swing cylinder r 4.7511 about that axis
  (clipped |x| ≤ 1.6, y ≤ 0); pivot boss SPHERES r 0.9959 at (±3.197, 0, 22)
  on the prong inner faces; tab top z=17.25 = 22 − 4.75 (tangent to the
  swing circle).
- **Top gap** (Y-prism): floor z=19.5, flanks exactly the line
  (x=1.6, z=19.5)→(x=2.6, z=24) i.e. |x| ≤ 1.6+(z−19.5)/4.5.
- **Top facet set**: front chamfer y+z ≥ 24; side chamfers x+z ≥ 27.5;
  front-side corner planes √2·x+y+z ≥ 28.9497 (= 24+3.5√2, meets the front
  chamfer along the vertical line x=3.5); back facets z ≥ 24−0.593(|x∓y|−5.28)
  (level lines along (1,1); slope measured).
- **Bore**: 2.6² through; bottom mouth y ±4.2 z<6.2 with 45° chamfer
  (4.2,6.2)→(2.6,7.8) on the y-walls only; ball-clearance pocket = z-cylinder
  r 3.2, z 0..5.2 (hips ball r3.0 + 0.2; frame is 5 thick + 0.2).

Frame-thigh mating checks: bore 2.6 = frame oct half-width 2.5 + 0.1;
pocket 5.2 = frame thickness 5 + 0.2; pivot boss/swing center z=22 ≈ frame
knee-fork region.

## Attempt log

1. att 1: full measured restructure (wedge-prism construction: profile in
   (s,z) extruded then rotated; sheared corner cuts as ±45° prisms with the
   arc profile) → 6/6+2/2 at 0.1517 in ONE authored attempt. Residual: 2×2mm³
   at the mouth chamfer.
2. att 2 (REGRESSED, discarded): replaced hull-of-slabs chamfer with a wedge
   whose region was inverted (cut the wall above the line). Turn tool
   non-regression saved it.
3. att 3 (REGRESSED, discarded): correct region, but the wedge face landed at
   y=2.6±1e-16 (rotation float dust) — NEARLY coplanar with the bore face —
   leaving a zero-thickness phantom membrane: hausdorff 1.13 with ZERO
   findings, volume ratio 1.001. Diagnosed by exporting the candidate mesh
   and printing argmax deviations (§5.15) + all-hits rays (double hit at the
   same y).
4. att 4: overshoot the wedge past the bore face (2.6→2.4) → 0.0180.

## Not done / next if reopened

- The tiny prong-top miter region (x 3.9..4.5, y −1.8..−2.4 and the
  side/back facet junctions) is approximated by the measured plane set;
  residual ≤0.04mm (the current hausdorff max). A yet-finer facet inventory
  there could shave it but no gate needs it.
- Optimizer pass skipped deliberately: all dims are exact probe fits
  (precedent: probe-fit dims return "already-optimal").
- strategiesTried updated in state.json.
