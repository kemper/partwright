# hand_open_left — session notes (2026-07-03)

## Verdict: CONVERGED — 6/6 MUST, 1/2 SHOULD, score 0.284 (attempt 1)

chamfer 0.0235 | hausdorff max 0.198 / P99 0.131 | IoU 0.9635 | volume ratio
1.003 | genus 0/0 | components 1/1. Only `area ratio` (SHOULD) fails: 1.163 —
staircase riser area, same as hand_grip_left (see below).

Converged in ONE authored turn: pure recipe transfer from hand_grip_left
(same class, same generator). This is the fastest hand convergence yet —
the whole session was 2 probes + 1 turn.

## What worked (grip recipe transfer, PLAYBOOK §5.13 + §5.18)

1. Read hand_grip_left/notes.md first — its converged generator (`gen.mjs`)
   survived in the shared session scratchpad. Reused verbatim except for the
   ledge list.
2. **Socket verified before reuse**: `probe fit --near -1.5,0,0 --r 2` →
   sphere r=2.900 at exactly [0,0,0], rms 0, inliers 1.0. Identical to grip
   and to the Dummy 13 ankle. The Dummy 13 wrist/ankle ball socket spec is
   now confirmed on 3 parts.
3. **Ledges re-measured, not borrowed**: 0.05mm slice-area scan found this
   part's ledges at z=0.0 (palm top, Δ−27mm²; fingers split into 4 outers
   above it), z=2.5 (Δ−16.5mm², thumb-tier top), z≈5.25 (Δ−2mm², finger-tier
   end). Grip's ledges (−0.15/2.5/3.25) do NOT transfer — the pose changes
   them. Everything else in the recipe transfers unchanged.
4. Uniform fine 0.4mm Z bands (23 bands), mid-band traces DP 0.05 / minEdge
   0.15, every band extruded 0.01mm past its top (the weld trap), per-band
   socket fill clipped to the sphere footprint + one exact
   `Manifold.sphere(2.9, 96)` subtraction at the end, sliver drop >0.05mm³.
5. **No debris voids needed**: unlike grip (3 components) and fist (split
   targets present), this target is a clean 1-component genus-0 mesh —
   checked target-profile.json before generating; the `--voids` flag stayed
   off.

## What's left / what I'd try next

- **area ratio 1.163 (SHOULD)**: staircase riser area — band-count-
  independent (total riser area ≈ projected area of sloped surfaces).
  Fixing it needs sloped walls (loft/hull between consecutive contours), a
  real restructure. Same accepted residual as hand_grip_left; judged not
  worth it with all MUST gates green.
- Scaffold erosion (PLAYBOOK §5.6) not done — the candidate is a digitizer
  dump + probed sphere. The extended fingers above z=0 are four clean
  per-finger tubes; if a CAD-readable version is wanted, they'd erode to
  tapered capsules easily.

## strategiesTried

- single-x-extrusion (v1): EXHAUSTED, do not retry.
- fine-z-slice-stack + ledge snap + eps overlap + socket sphere:
  CONVERGED (attempt 1, score 0.284).

## For sibling hand sessions

- Generator: scratchpad `gen-open.mjs` (= grip's `gen.mjs` with the ledge
  list swapped). Only two part-specific inputs: the ledge list (measure with
  a 0.05mm slice-area scan) and whether debris voids are needed (read
  target-profile components first).
- Socket sphere r=2.900 at [0,0,0] — verify with one probe, then trust it.
