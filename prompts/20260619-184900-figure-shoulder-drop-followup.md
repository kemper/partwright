---
session: "practical-bohr"
timestamp: "2026-06-19T18:49:00Z"
model: claude-opus-4-8
---

## Human

(Follow-up on the armpit/shoulder fix, reacting to the first render.) That's an
improvement but I think it can be better. We could weld even less and drop the
arms so the shoulder doesn't stick up so much.

## Assistant

## Key decisions

Two more nudges on top of the first pass:

- **Weld even less**: default body-weld k `0.45 → 0.32 · min(lowerArm, neck)`.
  The armpit opens wider and the arm reads as a separate mass joined only at the
  shoulder. Still a single watertight component (`isManifold`, `componentCount:
  1`, no warnings) because the upper-arm capsule still overlaps the chest.
- **Drop the deltoid further**: seat it `lerp(S, E, 0.18 → 0.32)` and trim
  `·1.0 → ·0.9` so the shoulder cap sits lower on the arm.
- **Drop the shoulder JOINT**: new `shoulderDropZ = headH · 0.12`, subtracted
  from the arm-chain shoulder Z. The glenohumeral joint really does hang below
  the neck-base/acromion line, so the arms now hang from a point below the top of
  the torso and the shoulders slope DOWN from the neck instead of the deltoid
  riding up level with the chin. This is the lever that fixes "shoulders stick up
  too much"; the deltoid/weld tweaks alone couldn't lower the attach point.

Verified: typecheck clean, 267 sdfFigure + joints unit tests pass, swimmer is
manifold/one-piece, and ballerina (arms overhead) + bodybuilder (muscled, arms
flexed) show no regression — raised arms still weld at the shoulder, muscle
masses still blend.
