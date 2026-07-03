# hand_fist_left — session notes (2026-07-03)

## Verdict: CONVERGED — 6/6 MUST, 1/2 SHOULD, score 0.2133 (attempt 3)

chamfer 0.0216 | hausdorff max 0.739 / P99 0.122 | IoU 0.9762 | volume ratio
1.001 | genus -2/-2 | components 3/3. Only `area ratio` (SHOULD) fails: 1.158 —
same staircase riser-area limit as hand_grip (band-count-independent; fixing it
needs sloped walls/loft, judged not worth it with all MUST green).

## What the part is (vs the grip sibling)

- **Wrist ball socket identical to grip/ankle: sphere r=2.900 at [0,0,0]**,
  `probe fit --near -1.5,0,0 --r 2` → rms 0, inliers 1.0. The whole hand
  family is modeled in the socket frame.
- **3 components**: main hand + two tiny debris shells (8 tris each,
  size ~0.013×0.054×0.027) at [-1.469,6.072,2.494] and [0.518,6.072,2.494]
  (splitStl). Both verified interior with >1.3mm in-plane margin. Reproduced
  as BOX voids — the topology gate bridges genus conventions now
  (expectedEngineGenus = 1 − components + genusPerShell = −2 here), so the
  grip-left torus workaround is obsolete.
- **Genus 0 per shell** (fist has no grip tunnel). All slice-level holes are
  transient knuckle-crease pockets.
- **One horizontal ledge: z=2.5** (wrist-block top, slice-area Δ−15.8).
  Everything else (base chamfer −2.5..−2.0, finger tapers) is smooth slope.

## What converged (generator: scratchpad genfist.mjs, adapted grip gen.mjs)

1. Grip recipe transplant verbatim (attempt 1, one turn: 0/6 → 5/6 MUST,
   chamfer 0.243→0.025): uniform 0.4mm Z bands snapped to the z=2.5 ledge,
   0.01mm extrude overlap, socket fat-slice fill clipped to sphere footprint
   +0.05 then exact `Manifold.sphere(2.9, 96)` subtraction, sliver cleanup
   (decompose, drop <0.05mm³), box debris voids.
2. **Remaining failure was a fabricated genus-1 handle in the knuckle region.**
   Localization method that worked (attempt 2's guess — dropping tiny hole
   contours — did nothing): build candidate STL headlessly (runPreview →
   writeBinaryStl), per-shell χ via weld+components (main shell genus 1),
   then **binary-search partial band stacks** (bands 0..K) for the K where χ
   flips: band 16 ([3.587,3.950]) completed the handle. Raster of band15 vs
   band16 target contours showed why: the 0.4mm step made band16's slab
   bridge OVER a crease void escape path (x≈−2.1..−1.2, y≈4.4–4.5) between
   two contact patches — a solid ring the target avoids because its contours
   morph gradually in z.
3. **Fix: halve the band pitch above the ledge (0.2mm for z>2.5).** Fingers/
   knuckle contours morph fast in z; finer bands track the morph and no ring
   forms. Verified genus 0/0/0 + 3 shells headlessly BEFORE spending the
   turn. Score 0.2133, phase done.

## What's left / next

- area ratio 1.158 (SHOULD): staircase riser area, needs loft/sloped walls —
  a real restructure (same conclusion as hand_grip_left; see its notes).
- Scaffold erosion (PLAYBOOK 5.6) not done: candidate is a digitizer dump +
  probed sphere + voids.
- hausdorff max 0.739 (pass, margin 0.06): tail sits at the staircase of the
  base chamfer region; finer bands below the ledge would shave it if a
  future gate tightens.

## For hand_fist_right

Likely an exact mirror — apply PLAYBOOK 5.14: verify bbox/debris/socket
x-negation, then append `.mirror([1,0,0])` to this part's best candidate.
Debris centers to expect: [1.469,6.072,2.494] and [-0.518,6.072,2.494].

## strategiesTried

- coarse-z-slice-stack (bootstrap): superseded.
- fine 0.4mm slice-stack + socket + voids: 5/6, genus handle.
- dropping sub-0.5mm² transient hole contours: NO effect on the handle
  (do not re-try for genus; it only trades ~0.15mm³ of pocket detail).
- 0.2mm bands above the ledge: CONVERGED.
