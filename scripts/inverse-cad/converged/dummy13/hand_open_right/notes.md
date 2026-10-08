# hand_open_right — session notes (2026-07-03)

## Verdict: CONVERGED — 6/6 MUST, 1/2 SHOULD, score 0.2858 (attempt 1)

chamfer 0.0234 | hausdorff max 0.1981 / P99 0.1321 | IoU 0.9631 | volume ratio
1.003 | genus 0/0 | components 1/1. Only `area ratio` (SHOULD) fails: 1.163 —
staircase riser area, identical residual to hand_open_left / hand_grip_*.

Converged in ONE authored turn via the PLAYBOOK §5.14 mirror shortcut from
hand_open_left (which itself converged in one turn, chamfer 0.0235 — the
metrics here match it almost digit-for-digit, confirming an exact mirror pair).
Whole session: 1 probe + 1 turn.

## What was verified before flipping (§5.14 preconditions)

1. **bbox**: right x-extent [-4.88896, 9.47864] = exact negation of left
   [-9.47864, 4.88896]; y/z extents identical to 1e-5.
2. **volume/topology**: identical volume 364.07976mm³, 1 component, genus 0
   on both (target-profile.json) — no debris voids needed on either side.
3. **socket**: `probe fit --near 1.5,0,0 --r 2` → sphere r=2.900 at exactly
   [0,0,0], rms 0, inliers 1.0. Origin-centered → maps to itself under
   mirror. (Dummy 13 wrist/ankle socket spec now confirmed on a 4th part.)

Then: left's `best/candidate.js` with the final `return solid;` replaced by
`return solid.mirror([1, 0, 0]);`. `.mirror()` handled winding itself.

## What's left / what I'd try next

- **area ratio 1.163 (SHOULD)**: staircase riser area, band-count-independent.
  Fixing needs sloped walls (loft/hull between consecutive contours) — a
  restructure of the shared hand generator. Accepted on all four converged
  hand parts; if ever fixed on one sibling, re-mirror to fix it here.
- Scaffold erosion (§5.6) not done — candidate is the left's digitizer-dump
  slice stack, mirrored. Any CAD-readable rewrite should happen on the left
  and be re-mirrored.

## strategiesTried

- deterministic bootstrap slice-stack: superseded (attempt 0, 0/6 MUST).
- mirror-of-converged-sibling (hand_open_left best + `.mirror([1,0,0])`,
  PLAYBOOK §5.14): CONVERGED (attempt 1, score 0.2858).

## For sibling hand sessions

- §5.14 mirror shortcut is now 2-for-2 on hand pairs (hand_grip_right in 2
  turns, hand_open_right in 1). Verification cost: read both target-profiles
  + one socket probe.
