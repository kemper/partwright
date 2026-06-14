---
date: 2026-06-14
branch: claude/anatomical-realism-9i9owt
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - public/catalog/athlete.partwright.json
  - public/catalog/bodybuilder.partwright.json
---

## Human

"you need to refresh from the latest main"

## Assistant

Merged `origin/main` (which had advanced 5 commits, including PR #667's `bust`
chest-mound knob) into the muscle-axis branch. The `bust` feature touched the
same rig surfaces as `muscle`, so I resolved the conflicts to keep BOTH axes:

- `RIG_FIELDS`, `RigOptions`, `Rig.opts`, and the `buildRig` opts return now carry
  `muscle` AND `bust`.
- `buildTorso` applies the muscle masses first, THEN the bust mounds (so a female
  muscular figure reads as a bust riding the pec, not the pec swallowing it),
  then the navel carve — keeping main's `torsoMasses`/`breastMounds`/navel work.
- Merged `__figureTestables__` and the figure.md rig-param list to list both.

Re-baked the two muscle catalog figures against the merged builder: the Athletic
Sprinter is `sex:'female'`, so she now picks up main's bust default (≈0.35) under
the crop top — verified she stays genus 1 / one component / hole-free and reads
correctly. Typecheck clean; 186 figure unit tests pass (my muscle/depth-floor
suite + main's bust suite).
