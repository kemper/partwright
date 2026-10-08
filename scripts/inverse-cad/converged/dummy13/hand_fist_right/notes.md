# hand_fist_right — session notes (2026-07-03)

## Verdict: CONVERGED — 6/6 MUST, 1/2 SHOULD, score 0.2029 (attempt 1)

chamfer 0.0217 | hausdorff max 0.683 / P99 0.122 | IoU 0.9760 | volume ratio
1.001 | genus -2/-2 | components 3/3. Only `area ratio` (SHOULD) fails: 1.158 —
the identical staircase riser-area limit as hand_fist_left / hand_grip
(band-count-independent; needs sloped walls/loft, judged not worth it).

## How it converged (PLAYBOOK 5.14 mirror shortcut, one authored turn)

Target is the exact x-mirror of the already-converged hand_fist_left:

1. Verified BEFORE editing (all by measurement, not assumption):
   - bbox: exact x-negation (min/max x swapped+negated; sizes, volume
     375.27mm³, 11214 tris, topology all identical).
   - splitStl: 3 components; debris shells 8 tris each at
     [1.469,6.072,2.494] and [-0.518,6.072,2.494] — precisely the negated
     left centers the left notes predicted.
   - `probe fit --near 1.5,0,0 --r 2` → sphere r=2.900 @ [0,0,0], rms 0,
     inliers 1.0 (origin-centered socket maps to itself under mirror).
2. Copied hand_fist_left/best/candidate.js (which already carries the
   0.2mm-band-pitch-above-the-z=2.5-ledge fix for the fabricated genus
   handle, §5.19a/b) and appended `solid = solid.mirror([1,0,0])` as the
   LAST op. Debris voids/socket subtract stay in left coordinates and get
   mapped by the final mirror — no per-feature coordinate editing.
3. Turn 1: 0/6 → 6/6 MUST, score 3.372 → 0.2029, phase done.

## What's left / next

- area ratio 1.158 (SHOULD): staircase riser area — same restructure
  (loft/sloped band walls) as the whole hand family; not attempted.
- Scaffold erosion (5.6) not done: candidate is the left's digitizer dump
  + probed sphere + voids + mirror.
- hausdorff max 0.683 (pass, margin 0.12): base-chamfer staircase tail,
  same as left.

## strategiesTried

- coarse-z-slice-stack (bootstrap): superseded.
- mirror-of-converged-sibling (5.14: left best candidate + mirror([1,0,0])):
  CONVERGED in one turn.
