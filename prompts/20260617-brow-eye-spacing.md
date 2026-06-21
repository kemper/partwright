---
date: 2026-06-17
branch: claude/dazzling-ritchie-ybscy1
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - public/catalog/expectant_mother.partwright.json
  - public/catalog/expectant_mother.thumb.png
  - tests/unit/sdfFigure.test.ts
---

## Human

Follow-up on the new flush eyebrows (#725): the brows are spread out farther
apart than the eyes themselves. Wanted a parameter for eyebrow distance/gap —
the distance from one eyebrow to the other — that defaults to the same as the
eye distance, so the brows sit right over the eyeballs. And update the expectant
mother catalog entry.

## Assistant

Measured it: the brows splayed to ±2.45 while the eyes only reach ±1.79. The brow
*centres* already sat at the eye lateral (the brow anchor and eye anchor share
`headH*0.18`), so the "spread" was really two things — the brow was **wider**
than the eyeball (halfSpan 0.28·headR each way), so its outer end ran ~37% past
the outer eye corner.

Fix, two parts:

- **`spacing` knob** — a multiplier on the eye spacing (default 1). Each brow's
  lateral centre is now re-derived from the eye anchors: `browMid ± headLeft *
  eyeHalfDist * spacing`, where `eyeHalfDist` is the eye centre's offset from the
  face midline. So by default each brow sits directly over its eyeball; >1
  spreads the pair, <1 draws them in. The brow keeps the anchors' forehead
  height/depth — only the lateral placement is tied to the eyes. This is the knob
  the user asked for, and it tracks eye spacing automatically.
- **Pulled the default `width` in** (preset widths 0.28→~0.20·headR). The centres
  already matched the eyes, so the visible splay was width; narrowing it makes the
  brow span the eyeball (inner end near the inner corner, outer end just past the
  outer corner — anatomically natural) instead of running wide. New extent ±2.18
  (~22% past, vs the old 37%).

Verified the new extent numerically (vite-node probe of the rig + brow/eye
bounds), in normal-shaded `model:preview`, and in a colored front bake (brows now
read as natural dark arcs over each eye). Re-baked the expectant-mother catalog
entry (`--require-labels brows` passes, 4479 brow triangles, manifold). Added
unit tests: default spacing keeps the brow within ~25% of the eye outer corner,
and the `spacing` knob spreads/tightens. Note: the headless catalog bake needs a
dev server already up at :5173 — `build-catalog-entry.cjs` connects to it rather
than starting one.
