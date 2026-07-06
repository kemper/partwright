# armor_inner_chest — session notes

## Verdict: CONVERGED (attempt 1, 6/6 MUST + 2/2 SHOULD, score 0.0047)

chamfer 0.0001 / hausdorff max 0.0066 (P99 0.0051) / IoU 0.9996 / volume
ratio 1.0002 / area ratio 1.0001. Best candidate: `best/candidate.js`.
ONE authored attempt after the bootstrap (2 attempts total). Essentially an
exact reconstruction — no optimizer pass needed.

## Measured structure (all numbers probed, none guessed)

First armor-class part. It is NOT a thin wrapped shell — it's a Y-prismatic
outline with an interior cavity cut, plus mounting features. Bbox
19 × 8 × 10, y-symmetric AND x-symmetric. Genus 3.

- **Outline** (constant over y ∈ [-3.5, 3.5], traced at y=-3.25): chest
  silhouette in (x,z): bottom z=0 x±9, 0.5 corner chamfers to (±9.5, 0.5),
  walls x=±9.5 to z=9, 1.0 chamfers to (±8.5, 10), top z=10 to x=±6,
  slants (±6,10)→(±4,6) (slope 2, line z=2|x|−2), inner top z=6 across.
  Extruded the full y ∈ [-4, 4].
- **Cavity cross-prism**, |y| < 2.5 EXACTLY (step walls ray-verified at
  ±2.5): everything except the two wings — |x|<4.6 at all z, plus |x|<8.1
  below z=3.2. Leaves L-shaped wings (outer walls full-height at
  |x|∈[8.1,9.5], shelf z=3.2 in [4.6,8.1], inner wall x=±4.6 up to the
  slant).
- **Inner clearance cylinder r=3.100 about the Z axis at (0,0)**: the plate
  inner faces are y=±2.5 planes blended with this cylinder — ray grid
  showed y(x)=sqrt(3.1²−x²) for |x|<1.833, z-invariant over the full plate
  height. (Clearance for the frame chest's spine socket block.)
- **Central rect tunnel** x ∈ ±1.6, z ∈ [1.9, 5.3], through both face
  plates (overshoot y ±4.5). These two plate tunnels + the wing/plate
  connection loop = genus 3 exactly.
- **Slot grooves ×4**: X-axis cylinders r=1.0477 centered at
  (y=±4.4983, z=5), x ∈ ±[4.8, 7.2], flat ends. Circle profile verified at
  FOUR y-samples (h(3.5)=0.3177, h(3.6)=0.54, h(3.75)=0.7338, h(3.9)=0.86;
  deepest y=3.4511 vs predicted 3.4506). Center sits ~0.5 OUTSIDE the y=±4
  face — an open snap groove, not a bore. Likely snaps over the frame
  chest's r=1.5 struts region / arm slabs; design intent may be r=1.05 @
  y=4.5, but the fitted values landed chamfer 0.0001 so not tuned.
- **Face chamfers on the side walls ONLY** (§5.21 inventory via y=3.6/3.9
  sections): 45° planes |x|+|y|=13 (wall x=9.5 at |y|=3.5 → 9.0 at the
  face). Top edge, slants, bottom, cavity edges all sharp. Cut with big
  45°-rotated cubes, inner face pinned exactly on the plane.

## Strategies tried

1. Deterministic slice-stack bootstrap → 2/6 MUST (score 1.10) — the 3
   coarse Y bands missed the curved inner face and slot flares.
2. Probe-driven primitive composition (above) → converged in one edit.

## What I'd try next

Nothing — all gates pass with huge margin. If reopened for parametric
cleanup, hoist (slotR, slotY) and innerCyl r into api.params; sensitivities
should be ~0.

## PLAYBOOK candidates discovered here

- Armor-plate recipe: full-silhouette prism − cavity cross-prism at exact
  measured |y| planes − clearance cylinder − grooves. See §5 additions
  reported to caller (armor plates are prism-minus-cavity, not shells;
  slot flare h(y) circle-fit; ray-grid z-invariance test for ruled inner
  faces).
