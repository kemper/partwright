---
date: 2026-06-16
branch: claude/adoring-lamport-gmg9mn
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/catalog/*.partwright.json (re-baked)
---

## Human

[On PR #693, reviewing the Tai Chi Master figure.] He has cylinders coming out of
his back. Is that how nipples are implemented? The nipples also are only partially
through the body — I expected nipples directly on the torso chest, not cylinders.
That figure also has a foot defect where the foot appears bent backwards.

## Assistant

Two distinct engine defects, both confirmed by rendering the tai-chi geometry from
the side/back at high resolution before and after.

**#706 — areola "cylinders out the back."** `buildNipples` approximated the bare
chest by a big sphere (curvature radius `1.4·chestX`) placed `surfR` *behind* the
front anchor, then intersected it with a Y-axis cylinder of length
`(surfR+eps)·2.2`. For a flat (bust-0) chest that intersection isn't a flush coin —
it's a deep plug running ~1.1·surfR (≈1.5·chestX) *backward* into the torso. On a
wide chest the plug stays buried; on the tai-chi master's narrow, shallow elderly
torso it punched a rod clean out the back. Fix: bound the clip cylinder to a SHORT
slab seated at the surface — the coin now pokes `eps` proud and sinks only
`discDepth = min(size·0.6, surfR·0.35, chestY·0.5)` into the body (enough to weld
under the hard union), so the back face stays near the front surface and can never
exit. The areola reads as the subtle flush disc the user expected. Added a
regression unit test asserting the coin's back extent stays within `0.4·chestX` of
the anchor (the old plug was ~1.5·chestX).

**#707 — raised foot "bent backwards."** The #701 plantarflexion derived the toe's
horizontal HEADING from the lower-leg (shin) bone. In the white-crane raised-knee
pose the thigh points forward (raiseFwd 28) but the deeply-flexed knee (bend 74)
folds the shin BACKWARD, so the shin-heading yawed the toe behind the figure — a
raised-in-front foot pointing its toe back. Fix: take the heading from the THIGH
(upper-leg bone), which encodes whether the whole leg is swept back
(grand-jeté / sprinter trailing leg → thigh back → toe correctly points back) or
merely raised in front (thigh forward → toe hangs forward-down). The downward
PITCH still follows the shin (a pointed foot continues the shin line); only the
horizontal heading moved to the thigh. Verified the thigh discriminator preserves
every confirmed case: grand-jeté legR (thigh back → toe back), ballerina arabesque
(thigh back → toe back), sprinter trailing leg (thigh back → toe back), while
fixing tai-chi (thigh forward → toe forward).

Re-baked the figure set against the fixed engine. Tai-chi master bakes to one
watertight component (componentCount 1, genus 0) with every label resolving;
tri-count dropped slightly (218k → 208k). Both fixes are no-ops on the cases that
already worked (wide chests bury the same shallow disc; planted feet and thigh-back
lifted feet are unchanged).
