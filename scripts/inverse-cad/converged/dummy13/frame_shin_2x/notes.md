# frame_shin_2x — session notes (2026-07-03)

## Verdict: CONVERGED

Best = attempt 1: **score 0.0027**, 6/6 MUST + 2/2 SHOULD, chamfer 0.0003mm,
hausdorff max 0.091mm, P99 0.0024mm, IoU 0.9998, volume ratio 0.9999,
genus 1/1, components 1/1, zero findings. 1 authored attempt (budget 15) —
single measured restructure over the bootstrap.

## What the part actually is (all numbers probed, not guessed)

The thigh's sibling limb segment. Y-long, z-flat, bbox 6 × 33.5 × 5.5.
Genus 1 (only the window — no slot/fork here, unlike the thigh's genus 3).

- **−Y end = knee ball**: sphere r3.000 c(0, −28, 2.5) — probe fit came back
  rms 0, inliers 1.0. Clipped flat at z=0 by the build plate (sphere would
  reach z=−0.5). This ball mates the thigh's knee C-clip socket (r3.1).
- **Neck**: Y-prism y −25.4..−24.0 (authored −26..−24; inner end buried in
  the ball) of a D-profile: circle r1.5 c(0,2.5) with flat bottom cut at
  z=1.2 (chord tangent x=±0.75). The flat clears the thigh channel's z<0.9
  tip shelf. The flat does NOT cut into the ball (ball surface is below
  z=1.2 wherever ball > neck).
- **Shaft end face** at y=−24.0 with a 0.5 × 45° chamfer around the full
  perimeter (hw 2.0 at the face → 2.5 at y=−23.5). Modeled as hull of two
  0.01 slabs with outer faces pinned exactly on y=−24 and y=−23.5; small
  profile = oct(2.5) miter-offset −0.5 (authored explicitly, 8 pts). No
  lead-in cone at the neck-face junction (area at y=−24.1 == neck area).
- **Shaft**: chamfered octagon 5×5 (hw 2.5, 0.5 × 45° chamfers on all four
  long edges), z 0..5, y −23.5..0 (prism runs to the spool center; the
  window carves the bridges out of it).
- **Window** (the genus handle): slab void z 1.0..4.1 (same asymmetric
  1.0/0.9 walls as the thigh) from the shaft face y=−5.000 past the spool;
  leaves bridges z 0..1 and 4.1..5 connecting shaft→spool at full oct
  width. Bridge material ends at y=0 exactly (sections at y=0.3/0.5 show
  pure spool chord, no slab).
- **+Y end = ankle spool**: identical profile to the thigh's hip spool,
  axis vertical at (0,0): r2.5, 45° V-groove to r1.5 at z=2.5 (groove z
  1.5..3.5), 0.5 chamfers at z0/z5 faces (r2.0), truncated-cone dimples
  r1.0→r0.5 depth 0.5 on both faces, subtracted LAST (bridge overlaps the
  spool center — the subtract-voids-last trap from the thigh).

## Why one attempt sufficed

Read frame_thigh_2x/notes.md first: spool profile, dimple spec, window slab
z-numbers (1.0..4.1), oct() profile, yPrism helper, hull-pinning and
subtract-last traps transferred verbatim — every one re-verified against
this target by chord math on the bootstrap traces + z/y section scans
before reuse. Only genuinely new features (ball, D-neck, end-face chamfer)
needed fresh probes: one `fit` (sphere, exact) + ~20 sections.

## Not done / next if reopened

- Nothing structural. Optimizer pass skipped deliberately: every dimension
  is an exact probe fit; chamfer 0.0003 leaves no numeric headroom.
- Candidate = best/candidate.js (also attempts/001). Fully parametric CAD-
  style code, no traced point dumps.
