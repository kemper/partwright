---
date: 2026-07-05
branch: claude/confident-carson-gpo63q
files_changed:
  - src/color/idProjection.ts
  - src/main.ts
  - tests/unit/idProjection.test.ts
  - public/catalog/pomni_articulated.partwright.json
  - public/catalog/pomni_articulated.tile.png
---

## Human

The painted Pomni still isn't at a quality level the owner loves — move
on to the next technique in the roadmap.

## Assistant

Diagnosed before building: most of what reads as "low quality" on the
painted kit is ASSIGNMENT NOISE — scattered black islets where Gemini's
seed image drew cartoon outlines, and white/skin mottling on the body
seams — not the tessellation floor. So the next technique landed in two
parts, and the noise fix shipped first because it validates without a
single Gemini call.

`paintDespeckle({within, minTriangles?})`: connected same-color
components smaller than the threshold are absorbed into the neighboring
color they share the most boundary edges with. Two safety rules make it
deterministic and non-destructive: whole components move or nothing
moves (a connected thin feature — an eye outline ring, a partition
stripe — attaches to its large parent, so it can never be nibbled), and
fragments absorb only into strictly LARGER components (small fragments
absorbing each other would churn and can oscillate; monotone upward
absorption terminates by construction). The kernel found this rule the
hard way: the first draft let equal-size fragments eat each other and
the unit test caught the round-trip churn immediately.

On the painted kit: 22,045 triangles reassigned in 1.3 s; the face's
outline speckle and the torso/pelvis mottling collapsed into clean
fills. The remaining face-side black patches are large CONNECTED seed
content (Gemini drew them), correctly untouched — source-image quality
items on #885, not post-pass fixable. The catalog entry payload and
tile were re-exported with the despeckled paint. Boundary subdivision
(the crispness half of the technique) is next.
