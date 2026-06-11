---
session: "01B8i3Nc4JgG6iV6eAsrYFq6"
timestamp: "2026-06-11T21:30:00Z"
model: claude-opus-4-8
---

## Human

After the previous rocker fix merged, the user: "the rock guitar guy is better
but it's still quite off in that the guitar is crooked and one hand just passes
through it. I'm curious to know how to make this better. Can I make part of the
api and awareness of the XYZ coordinate of the palm of a hand to connect things
to?" Then: "Make a new PR with the changes. Do both steps in one PR."

## Key decisions

**Diagnosis.** Both defects traced to one gap: `rig.joints.handL/R` is the hand
*centre*, and there was no orientation data exposed. The previous rocker aimed
the guitar neck at that centre → the neck ran straight through the palm
("passes through"), and nothing related the guitar's axis to the hand, so it
read "crooked." Internally the hand builder already computed the palm normal
(`cross(hinge, foreDir)`) but threw it away.

**Step 1 — grip-frame API (`src/geometry/sdfFigure.ts`).**
- Added `rig.grip.L` / `rig.grip.R`, each a `GripFrame { point, palmNormal,
  gripAxis, reach }`. `point` is the grip *cup* — offset from the hand centre
  toward the palm by `0.72 × r.hand` — so a prop seated there sits IN the closed
  fingers instead of through the centre. `gripAxis` is the finger-splay axis a
  held bar lies along; all terms are spine-transformed like the joints, so the
  frame tracks pose and lean.
- Added `F.holdAt(node, grip, opts?)` — orients a prop's local long axis
  (`opts.along`, default +Z) to `gripAxis` and seats its origin on `point`. The
  axis→Euler alignment is derived for the engine's Rz·Ry·Rx convention
  (`eulerAlignZ`: with rz=0, `R·[0,0,1] = [cx·sy, −sx, cx·cy]`).
- 8 unit tests (orthonormal axes, palm offset direction, pose/spine tracking,
  holdAt alignment for +Z and +X props, option validation). Documented both in
  `public/ai/figure.md` for UI↔API parity (the in-app AI reads it).

**Step 2 — rocker rebuild (`examples/figure_rocker.js`).** Delegated the first
pass to the `model-sculpt` subagent: neck aimed at `gL.point` (not `handL`) →
no pass-through; body built upright facing −Y with its axis derived from the
bouts → not crooked. Then hand-tuned the body from a thin paddle into a real
guitar by adding a pinched **waist** section between enlarged bouts (a large
smoothUnion blend had melted them into one oval). Final: manifold,
componentCount 1, **genus 2**, all 11 paint labels resolve. Rebaked
`rocker.partwright.json` under the same catalog gates.

**Trade-off accepted:** the body stays a shallow forward-facing plate (a deeper
body tunnels through the curved torso skin → genus 4); a strap capsule would
fill the small body↔torso gap but adds a topological handle, so left out.
