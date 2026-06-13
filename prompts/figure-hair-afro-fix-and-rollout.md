---
date: 2026-06-12
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_afro_funk.js
  - examples/figure_rocker.js
  - examples/figure_superhero.js
  - examples/figure_sitting_reader.js
  - examples/figure_princess.js
  - examples/figure_warrior_pose.js
  - examples/figure_waving_kid.js
  - public/catalog/*.partwright.json (rebake)
  - public/catalog/*.thumb.png (rebake)
---

## Human

"The afro punk looks terrible. The hair covers his whole head. You need to
iterate on that and make it better. I'd also like to see the other catalog
entries updated to use the new hair API so I can see what works for each
model."

## Assistant

Two fixes in one pass.

**Afro rework.** The original afro was a big sphere centred near the head
centre, so it bulged forward over the face — the result read as a face buried
in a pom-pom. Reworked it to (1) an ellipsoid that's taller than it is deep,
(2) lifted up `0.42·head` and pushed back `0.38·head` so the bulk rises above
and wraps behind the skull instead of overhanging the face, and (3) a
per-style face-window enlargement (`winXMul`/`winZMul`) so the afro frames an
exposed oval face. The window multipliers default to 1, so no other style
moves. Confirmed front + iso headlessly before re-baking.

**New hair across the visible-hair figures.** Assigned a fitting style to each
figure where hair actually shows, then re-baked (palettes recovered via
`--palette-from-existing` so colours are preserved, genus + label gates on):
- rocker → `spiked` (the obvious rocker fit)
- superhero → `spiked`
- sitting_reader → `bob`
- princess → `long` + `part:'center'` + `texture:'wavy'` (flowing hair under the crown)
- warrior_pose → `braids`
- waving_kid → `afro` (curly kid)

Left the headgear-covered figures alone on purpose — chibi_wizard (big hat),
staff_mage (hood), karate (short, headband area), strongman (short/balding
circus look): a new hairstyle there is hidden by the hat/hood, so changing it
is churn with no visible payoff. Ballerina keeps its `bun` — that's already the
right call for ballet. All seven re-bakes: `isManifold`, `componentCount: 1`,
under the ~200k tri budget, zero warnings.
