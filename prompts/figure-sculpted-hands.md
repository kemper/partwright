---
date: 2026-06-11
branch: claude/hopeful-franklin-6ucma0
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/figure_waving_kid.js
  - examples/figure_ballerina.js
  - examples/figure_chibi_wizard.js
  - examples/figure_warrior_pose.js
---

## Human

(Same session as the elbow fix.) Stage 2 of the figure round: sculpted hands
with fingers — previously "hands are blobs" was a known gap the user had
asked about.

## Assistant

Design decisions:
- Three fingers + thumb (the art-toy convention), not four: at figure scale
  four fingers force inter-finger gaps below the march cell and weld into a
  web; three keep the gaps ≥ ~1.5 fine cells. Fingers are ADDITIVE capsules
  (no carving → no sub-cell topology trap); the failure mode of an
  under-resolved additive finger is aliasing away, which the new
  `F.handDetail(rig)` detail spheres (mirroring `faceDetail`) prevent.
- The hand frame derives from the rig, never hand-typed: fingers extend
  along the forearm direction and splay across the (newly exposed)
  `rig.dir.elbowHinge*` axis; the palm faces hinge × forearm — the same
  plane the elbow curls in, so posed arms keep anatomically-plausible hands.
- `fingers: false` keeps the legacy blob/paddle/sphere hands for chibi or
  low-poly looks; sculpted is the default since the catalog gets re-baked
  and verified in this same round.
- Iterated on isolated probes in .plans/ (hands-only and one-hand close-up
  models) per the project work loop; the first fist read as a bowling pin —
  knuckle SPHERES melt into the ball under a soft weld, so the final fist
  uses short capsule ridges with a tight k.
- Ballerina's overhead hands interpenetrated in a tangle with fingers on
  (abduct 165 made the palms overlap); eased to 157 so the fingertips meet.
  All four FK-handed examples re-verified: 1 component, manifold, genus ≤ 2.
