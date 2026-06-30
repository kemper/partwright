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

After diagnosing why every AI agent fails to "rotate the hand 180° to hold the
sword on the other side" — the existing `palm`/`thumb` knobs roll about the
upper-arm axis, which couples to `bend` and so the forearm always moves with
the wrist — the user said:

"ok. Add the ability to rotate the hand/arm and prove it solves this problem."

## Assistant

Added **`arm*.roll`** — a wrist roll about the gripAxis (held prop's long axis),
applied AFTER bend/palm/thumb. Implementation in `armChain`:

```ts
if (p.roll) foreDir = norm3(rotAxis(foreDir, hinge, p.roll));
```

That's it — one line. The held prop's long axis is `hinge`; rotating `foreDir`
about `hinge` keeps the prop fixed and swings the wrist (and the rest of the
forearm-and-hand basis derived from foreDir) to the other side of it. The hand
mesh placement uses `rig.dir.lowerArm*` = the new rolled `foreDir`, so it
rotates automatically.

Validation:
- **Knight pose was changed by adding ONE field**: `armR: { …, roll: 180 }`.
  Sword stays exactly vertical (gripAxis bit-identical to the no-roll pose,
  asserted in a unit test); hand swings 180° to the other side of the blade.
  No other pose param changed. Manifold, 1 component; catalog re-baked.
- **Unit test** asserts the structural guarantee: `gripAxis` identical, `palmNormal`
  and `reach` negated (= exact 180° rotation about gripAxis). 30 figure tests
  pass; full suite 1634 pass.
- **Docs** updated: `arm*.roll` in the joint-param table + the JointPose summary.

The user's diagnosis was right: the failure class was an API gap. `palm`/`thumb`
roll about the upper-arm axis, which `bend` cascades — so 180° flips always move
the arm. `roll` rolls about the gripAxis — strictly perpendicular to that
coupling — so a wrist flip is now a single, structurally-correct knob.
