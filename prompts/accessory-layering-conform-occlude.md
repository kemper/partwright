---
date: 2026-06-22
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/figureAttachment.test.ts
  - examples/figure_knight.js
  - examples/figure_scholar.js
  - examples/figure_noble_lady.js
  - public/ai/figure.md
---

## Human

Second review: warrior holds the sword palm-down — turn the hand so the palm
grasps it (the hand system should know where the palm is). Scholar's belt goes
around his arms — it should wrap the torso and terminate at the arms (or wrap
fully when arms are up); solve this CATEGORY well. Noble lady's necklace juts
across her blouse — a necklace should lie flush on skin/clothes but be covered by
hair. "Treating this all as one big SDF extrusion seems like part of the
problem... we haven't defined a concept of layers for SDF so we can say what
label/object wins when they collide." (Chose: layering = auto default + explicit
override; necklace = draping down the chest.)

## Assistant

The belt/necklace problems are one architectural gap — no LAYERING. Designed a
**conform + occlude** model (SDF-native, pose-reactive, printable):

- **`holdAt` full-frame grip.** It only pinned ONE axis (blade → gripAxis),
  leaving roll free → palm-down. Now it binds TWO: +Z → gripAxis AND +Y →
  `palmNormal` (the hand's known palm), via `eulerFromBasis`. The fist now grasps
  the sword. `opts.up: 'palm'|'reach'`.
- **Conform + occlude.** A worn band (a) conforms to its base surface (belt →
  torso CORE, no arms) and (b) SUBTRACTS the objects in front of / draped over it.
  New `occlude` opt (node/array) + `rig` opt that auto-adds the default occluders
  (arms for any band; arms+hair for a neck ring; `RingFrame.region` tags which).
  So the belt wraps the torso and TERMINATES at the down-arms — and re-wraps fully
  when they lift, with zero pose special-casing (the arms simply aren't at the
  waist then). Same on `F.strap`. This beats a label-priority compositor because
  the failure is geometric (the band physically balloons), not just colouring.
- **`drape`** dips the front of a ring down the chest → a draping necklace; with
  `occlude:[hair]` it lies flush on the gown and the hair falls over it.

Applied to all three figures (re-baked): knight grip + belt-terminates-at-arms,
scholar belt-terminates-at-arms, noble lady draping necklace under hair. Tests +
`figure.md` updated. Tracking: #840 (closed) / this is the follow-on review round.
