---
date: 2026-06-19
branch: claude/nice-dijkstra-xxdsz6
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
---

## Human

(Reviewing PR #748 in the catalog) The new hands look terrible — corrupted
fingers, bony palms, gaps, crater-like regions, and the fingers aren't
separated like the old three-finger hands. The old hands weren't bad, they just
needed one more finger and to be less round (flatter palm/back, less
palm-to-back thickness). My rewrite was a substantially different algorithm.
Show several previews of an improved hand. → Picked variant D, then: slightly
longer + configurable finger length, perfectly-flat-but-organic palm/back,
configurable palm thickness, a preset to return to the puffy hands, and
configurable finger count.

## Assistant

Root cause of the defects: the first rework (the "metacarpal pad" — two thin
swept capsules, fr=0.155·r.hand) was verified at a FINE preview edgeLength
(0.18) but the **catalog bakes coarse** (~0.5 global; the hand detail sphere
marches at `r.hand*0.085` ≈ 0.21). The thin palm/fingers fell near/below that
march resolution, so they aliased into craters and corrupted fingers. The old
hand survived because its capsules were fat (fr=0.24·r.hand ≈ 3× the edge).

New approach — go back to the robust round-capsule algorithm, but flatten
correctly:
- **Organic round palm clipped flat.** Palm is a tapered wedge (narrow wrist →
  wide knuckles) of FAT capsules, then intersected with a thin **rounded slab**
  whose thin axis is the palm normal (`eulerAlignZ(palmN)` orients it for any
  pose; the rounded slab edge keeps the perimeter organic, not a deli-slice).
  Width and finger separation are preserved; only the bubbly front-to-back depth
  is compressed. This is how the SDF achieves "flat" without a non-uniform scale
  (which would break the distance field).
- **Flatten the palm ONLY, not the fingers.** Fingers are round capsules unioned
  on top, left off the clip — so they keep their section AND can curl for the
  `relaxed` grip without the slab slicing off the curled tips.
- **Parameterized:** `count` (fingers, default 4, 3–5), `length` (finger-length
  multiplier, default 1; default profile lengthened), `palmThickness` (flat depth
  fraction of r.hand, default 0.46). `fingers:false` keeps the legacy puffy preset
  (back-compat). Finger splay × `side` for true L/R mirror symmetry.

Verification (the step I botched last time): rendered all three grips AND a full
figure AT CATALOG RESOLUTION (within the detail sphere) — open/relaxed/fist all
clean, manifold, single-component, fingers well-separated, palm/back flat,
relaxed fingers curl freely above the flat palm. Real examples (athlete, boxer)
still build manifold/1-component.

Tests: replaced the fragile fixed-height finger counter with a topographic-
prominence reach-peak counter (measures how far the surface reaches along the
forearm across the splay fan, counts the humps) — robust to differing finger
lengths and the fan spread. Asserts default=4, `count:3`→3, `count:5`→5, plus
`length` and `palmThickness` bounds effects. 250 figure tests green; full
preflight green.
