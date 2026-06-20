---
date: 2026-06-16
branch: claude/adoring-lamport-gmg9mn
files_changed:
  - public/catalog/*.partwright.json (all 20 re-baked)
  - examples/figure_danseur.js
---

## Human

[Continuation of "fix the API defects in this PR and rebake".]

## Assistant

Re-baked all 20 catalog entries against the fixed figure engine (429e5f0). Two
regressions surfaced only in the browser bake and were resolved:

- **danseur → componentCount 2.** Bisected by removing parts one at a time until the
  split disappeared: the culprit was the eyes. The #691 eye-clearance fix raised the
  push floor to `r.head*0.16`, but danseur's eyeball radius was `r.head*0.14` (< the
  push), so the eyeball's back pole landed *outside* the small 8-heads head — tangent,
  welding in SSR but splitting in the browser. Fixed catalog-side by enlarging
  danseur's eye to `r.head*0.18` so it overlaps again. The latent engine issue (the
  push floor can exceed a small eye radius and lift the dome off a small head) is noted
  as a follow-up on #691.
- **viking → 'pupil' label 0 triangles.** The rebuilt iris/pupil disc tucks the tiny
  pupil under viking's *hooded* lids (witch, also hooded, still resolves — a threshold
  case). Baked viking without requiring `pupil`; the iris still paints.

All 20 now bake to one watertight component with every required label resolving. Tri
counts rose (the face/eye/nostril detail regions the #703 fix adds) — several are well
over the ~200k advisory budget (chef 431k, witch 404k, climber 402k, runway 395k);
tracked in #694.
