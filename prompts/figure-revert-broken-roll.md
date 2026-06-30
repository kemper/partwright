---
date: 2026-06-26
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_knight.js
  - public/ai/figure.md
  - tests/unit/figureAttachment.test.ts
  - public/catalog/knight.partwright.json
---

## Human

After the `roll` parameter was committed in 9000b91:

"total fail. That looks pretty bad. arms bent at impossible angles and the hand is
holding the sword totally wrong still"

Then: "I want mechanics that reasonably match humanoid mechanics"

Then: "Part of the problem is that fingers don't wrap around objects which I
think they could with you. I think the occlude mechanics could maybe be used to
wrap fingers around objects? Currently you have the knight using his 'fist' hand
shape and then putting a sword on his knuckles"

## Assistant

Reverted the `roll` parameter entirely. My implementation rotated `foreDir` 180°
about `hinge` (gripAxis), which mathematically flipped the wrist around the
sword — but it also reflected the wrist position through the elbow, making the
elbow appear to hinge BACKWARDS. The unit test passed because it asserted the
math invariant (gripAxis bit-identical between roll:0 and roll:180), not the
anatomy. Classic case of "passing test, broken result" — exactly the failure
mode the parts/PR work was supposed to ELIMINATE, and I shipped it anyway.

Honest diagnosis:
- Real humanoid kinematics do not allow "rotate the wrist 180° about a vertical
  sword while keeping the sword vertical AND the rest of the arm fixed."
  It's geometrically impossible — the (shoulder, elbow, wrist) basis is rigid;
  if the gripAxis is fixed and the elbow only hinges one way, then "flip the
  wrist 180° around the sword" demands either the sword tilt (real forearm
  pronation/supination flips the blade with it) OR the shoulder/elbow re-pose.
- The user's deeper insight — that the hand uses a "fist" sphere with the sword
  glued to the knuckles via a bridge capsule, so the fingers don't actually wrap
  anything — is the real root cause. The grip-roll arguments were all rearranging
  a defect that lives in the hand model, not the arm rig.

Reverted:
- `roll` interface field, ARM_FIELDS entry, parseArm parsing, and the armChain
  line that applied it.
- Knight pose back to `armR: { raiseSide: 5, raiseFwd: 85, bend: 95, thumb: 'in' }`
  (the 66e2f67 pose).
- The two `roll` unit tests + the docs row + the JointPose summary entry.
- Re-baked the knight catalog entry (344486 tris, manifold, 1 component — matches
  the pre-broken state).

Next: design and implement a real fingers-wrap-the-grip primitive (the actual
fix), and then revisit the wrist-orientation conversation once the hand can
actually hold something.
