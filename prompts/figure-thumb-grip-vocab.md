---
date: 2026-06-23
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/figureAttachment.test.ts
  - public/ai/figure.md
  - examples/figure_knight.js
---

## Human

The knight's hand is still wrong — humans grasp with the thumb up or pointing
inward, and his thumb points down. Step back: why do AI agents fail so hard at
this, and how do we categorically fix it? (Long discussion: the recurring
failures are one meta-problem — authoring continuous geometry blind, with
inter-object spatial relationships invisible in source, no semantic vocabulary,
and verification-by-eyeball instead of by-assertion. Chose to build: priority
layering + invariant gate + semantic rig vocab; fold the 3 figures into it.)

## Assistant

First slice of the architecture (tracking #853): the **semantic grip vocabulary**,
the piece that fixes the thumb-down grip at the root.

The grip frame had `palmNormal`/`gripAxis`/`reach` but **no thumb** — so "thumb up"
was literally inexpressible and my earlier `palm` hint solved the wrong rotational
DOF, leaving the thumb wherever it fell. Added:

- **`GripFrame.thumbAxis`** — ground-truth thumb direction, matching the
  canonicalHand thumb (it curls over the front of a closed grip, ≈ `0.84·reach +
  0.52·palmNormal + 0.17·side·splay`). Exposed in `poseProbe` so it's assertable
  (`grips.R.thumbAxis·[0,0,1] > 0` ⇒ thumb up).
- **`thumb: 'in'|'up'|'down'|'forward'|'back'|'out'`** pose hint — solves the
  forearm roll about the arm axis so the thumb points the human way. Supersedes
  `palm` (kept for back-compat; mutually exclusive). Rolling the hinge about the
  arm axis rotates the whole hand frame rigidly, so the signed-angle solve is exact
  for the ⊥-axis component.

Key realization documented in figure.md: thumb ⊥ bar and bar ⊥ forearm, so "thumb
up" and "blade up" are *coupled* for a fist — you pick the thumb (the human
constraint) and aim the blade via the arm pose. The knight now holds his sword
`armR:{raiseSide:12,raiseFwd:35,bend:80,thumb:'in'}` — thumb toward the body, blade
rising up-forward; verified the fist wraps the grip in a 1400px hand close-up.

Catalog re-bake deferred to the figure pass (F.layers occlusion + necklace land
together). Next: F.layers priority compositor + the invariant gate (#853).
