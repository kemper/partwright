---
date: 2026-06-14
branch: claude/lip-shapes-presets
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/faces/bust_natural_lips.js
  - examples/faces/bust_masculine_mouth.js
---

## Human

After #664 merged (mouth-options expansion), the user said the merged `divided`
two-lip lips looked bad ("duck-billed"). Over several rounds I prototyped refined
lip mockups (throwaway `/tmp` snippets, rendered in colour) and the user reviewed
batches: feminine refined (A–M), then masculine (N–S, re-rendered larger to match
size). The user liked the direction and the tone options, then said: "I want the
recent mockups implemented. Please make a new PR" and "I trust your pick of the
variety/list."

## Assistant

Implemented the reviewed mockups as a curated set of named **`lipShape` presets**
on the figure builder's `style: 'lips'` path. Picked 6 shapes spanning the range
the user reviewed: `natural` (thin upper + full lower), `full` (plump, sharp bow),
`thin` (slim elegant), `wide`, `rosebud` (petite), and `flat` (the masculine /
neutral mouth — wide, thin, near-flat upper). Shape is kept **orthogonal** to the
already-shipped axes: `expression`/`curve` still bows it, `smirk` skews it,
`fullness` scales thickness, `width` overrides the preset width — so e.g.
`{ lipShape: 'flat', expression: 'slightFrown' }` is the stern masculine set.

The geometry is a faithful port of the reviewed mockups into one parameterized
builder (`buildLipShape` + a `LIP_SHAPES` ratio table + `lipChain` helper): a
tapered cupid's-bow upper (Gaussian peaks, `bowFullAmt` concentrates volume at the
peaks; `peakH:0`+`archH` gives the flat masculine upper), a fuller lower lip, and a
parting groove (`smoothSubtract`) — all riding the expression bend/smirk and
sitting on the face surface (minimal forward bias, no duck-bill protrusion).

Wiring: `style:'lips', lipShape:<preset>` uses the refined builder; `divided:true`
now maps to `lipShape:'natural'` (upgrading the merged crude two-tube divided —
that was the bad-looking one); bare `style:'lips'` (no shape) stays the
byte-identical simple ridge. `mouthAccents('lips')` inherits `lipShape` for the
painted/labelled path. Added `lipShape` to `MOUTH_FIELDS` (validated via
`assertEnum`).

Verified all 6 presets through the REAL API (not just the mockups) with
`model:preview`: each is `isManifold:true`, `componentCount:1`, lips paint resolves
to real triangles (1107–3606), 0 warnings; a colour montage matches the reviewed
mockups. Updated `bust_natural_lips.js` to `lipShape:'natural'` and added
`bust_masculine_mouth.js` (`lipShape:'flat'` + `slightFrown`). 189 figure unit
tests (lipShape presets additive, width override, differ-in-width, unknown-shape
rejection) + full unit tier (1412) green; preflight exit 0.

This is a follow-up enhancement on top of the merged #664 — the mouth *system*
shipped there; this swaps in the good-looking lip *shapes*.
