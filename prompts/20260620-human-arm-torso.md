---
session: "figure-human-arms"
timestamp: "2026-06-20T15:45:00Z"
model: claude-opus-4-8
---

## Human

The figure arm→torso fusion still doesn't look human. Reference photo (lean
muscular man, arms at sides): the arm hangs mostly free, only the upper-inner arm
nears the armpit, the torso flares (lat) to meet it, and there's a crease — not a
web. Also the shoulder bulges were too big. Do this as its own PR; show previews
in chat. Make the lats much less pronounced on leaner figures. (Follow-up: the
trapezius read as a bumpy embedded sphere — make it a smooth uniform neck→shoulder
extrusion.)

## Assistant

## Key decisions

**Root cause (measured): the arm had no FORM to meet.** A vite-node probe walked
`evaluate` across the armpit: the top of the armpit gap was ~0.82 (right at the
mesh-resolution floor, ~2·edgeLength) and below it the arm physically OVERLAPS a
smooth torso ellipsoid. `smoothUnion` can only add a convex fillet, so it filled
that overlap into a web. The photo's torso instead flares (lat) and the arm
creases against it.

**Fix (a)+(b), pure mesh, no engine change:**
- **Always-on structural trap + lat**, scaled by `structural = (0.30 +
  0.40·weight)·(1 − muscle)` — so it FADES OUT as the existing muscle masses take
  over and shrinks for lean/low-weight builds (the "less pronounced on leaner
  figures" ask). Built in the rest frame + re-leaned exactly like the muscle
  masses (issue #702 machinery, hoisted out of the `muscle>0` gate so both paths
  share it). The lat is a tapered capsule flaring toward the armpit and tapering
  to the waist, giving the arm a shelf to crease against.
- **Trapezius = tapered CAPSULE neck→shoulder**, not an ellipsoid. The first cut
  used an ellipsoid which read as a sphere embedded in the shoulder (the user's
  "bumpy" note); an extruded capsule along the neck→shoulder line is the smooth
  uniform ramp.
- **Smaller/lower deltoid** (`0.6·upperArm`, seated `lerp(S,E,0.42)`) carried from
  the prior PR — the shoulder bulge.
- **Shoulder SEAT**: a short buried plug from inside the chest out to the joint,
  so an arm can never detach at the shoulder regardless of pose (the glenohumeral
  joint sits just outside the chest ellipsoid).

**Abduction was tried and REVERTED.** Adding a cos-faded hang-abduction to the arm
angle (a) broke the `raiseSide:0 = perfectly vertical` contract (a real unit-test
and user-control guarantee), (b) tipped viking + grand-jeté into detaching an arm,
and (c) amplified a latent L/R open-hand asymmetry past tolerance. The lat shelf +
smaller deltoid already deliver the open armpit / forearm daylight, so the global
abduction's marginal gain wasn't worth the regressions — dropped it, kept the
seat. (If more arm splay is wanted later, bump the *default* raiseSide rather than
overriding explicit angles, and fix the latent hand asymmetry separately.)

**Verification:** 267 figure/joint unit tests pass; all 51 figure catalog entries
re-baked single-component + manifold (grand-jeté and viking specifically
re-checked — the seat made them robust). Verified visually across swimmer (lean),
bodybuilder (muscled), danseur/grand-jeté (arms up/out), viking (arms forward),
toddler (child).
