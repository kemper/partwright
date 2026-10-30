---
date: "2026-10-24T19:05:00Z"
task: "fix: Ned likeness — round lidded eyes, C.muzzle, leaf ears"
pr: 1099
areas: [tooling, docs, agents]
cost: high
---

## Lacked
- I shipped the first Ned after checking it against my *own* earlier renders,
  not the photos. The user immediately named three likeness misses: non-round
  eyes, generic ears, and a mouth groove instead of a muzzle. A side-by-side
  with the reference crop at the same angle would have caught all three
  before the PR went up. (cost: a full extra round)
- I misdiagnosed a "mask" ridge three times (the skull junction, then a
  detail-sphere seam, then the ears' detail spheres). The cause was the eye
  rim blob. Rendering with features toggled off would have found it in one
  pass.

## Learned
- **Round eyes in an SDF face = a concentric eyelid shell plus a round
  opening.** Any opening sized from one skin depth either shows a socket wall
  or gets bitten by a proud cheek or bridge.
- A creature mouth reads from **volume** (upper-lip pads overhanging a set-back
  lower lip). A tube groove on a flat face reads as a drawing.
- An ear's likeness lives in its silhouette and slope. A symmetric tapered leaf
  reads as "generic ear" however good the cupping is.

## Longed for
- A `model:preview --compare-photo ref.png@az,el` that tiles the reference
  crop next to the render at the same angle. That one image is what made the
  second pass converge.
- A `--toggle feature1,feature2` bisect mode for kit features, to find which
  feature causes a surface artifact.
