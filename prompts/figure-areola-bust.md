---
session: "figure-nipples-belly-buttons"
timestamp: "2026-06-14T20:30:00Z"
model: claude-opus-4-8
tools: []
---

## Human

Reviewing the first nipple/navel previews: the navel is okay, maybe could be a
little better. But the nipples are just tiny bumps identical to the skin tone —
not what I had in mind. I want the nipples to have colour options, by default a
slightly darker shade of the figure's skin. They also pop out too much and are
too rounded — a lot of people have areolas relatively flush with the chest and a
very small nipple. Doesn't need photoreal, but should look better. Make new
preview images as a test. Also: I'd like to see breast-mound previews. I'm
hesitant about binary gender labels for that feature — maybe a breast size/shape
parameter, with a default applied to a female figure. Previews along those lines
too.

## Assistant

Prototyped (throwaway snippets, colour rendered via `api.paint.label`, which
`model:preview` resolves), showed comparison montages, and used AskUserQuestion
to lock defaults before wiring: flush areola + tiny nipple; continuous `bust`
with `sex:'female'` pre-filling a default; default size small (~0.35); areola
colour auto-derived darker skin.

Implementation (revising the same PR/branch):
- **`bust` rig knob** (0..2, default 0). Deliberately **decoupled from `sex`**
  per the user's hesitation — any figure can carry any value; `sex:'female'` only
  pre-fills ~0.35 when `bust` is omitted. It's a rig proportion (like
  sex/age/weight), so `F.torso(rig)` blends the per-side mounds from `rig.bust`
  automatically; `bust:0` stays byte-identical. `breastMounds` is the shared
  helper so the mound geometry and the nipple anchors (which ride the mound apex)
  can't drift.
- **`F.nipples(rig, {size, nipple})`** — moved the nipple out of `F.torso` into a
  TOP-LEVEL part (like `F.face.eyes`) because it must carry the `'areola'` paint
  label, and labels don't survive the smooth body weld. The flush look reuses the
  **iris-disc trick** already in `buildEyes`: a coin clipped from a sphere a hair
  larger than the local surface, so it sits flush and follows the chest/mound
  curvature instead of bulging; the nipple is a deliberately tiny nub.
- **`F.areolaColor(skin, factor?)`** derives the default darker-than-skin tone
  (everything in the figure system is painted by label, so this is the
  "auto-derive" honoured as a one-call helper + baked into catalog palettes).
- Catalog: swimmer/sumo/strongman switched to `F.nipples` + an `'areola'` palette
  colour (strongman keeps a hand-placed areola on its puffed pec, documented).
  The three `sex:'female'` figures (yoga/diva/cornrows_runner) now carry the
  default bust → re-baked; verified the clothing still covers the mound (coverage
  is guaranteed by construction — the garment is the body inflated/trimmed).

Tests cover bust defaulting/override + range, `breastMounds` null-vs-present and
apex-forward, anchors riding the apex, `F.nipples` self-labelling 'areola', and
`areolaColor` darkening. Docs (`public/ai/figure.md`) rewritten for the three
pieces (bust knob / `F.nipples` / navel) + `areolaColor`. preflight + catalog
lint green; all six re-bakes manifold/single-component.

Filed #670 earlier for the broader bust shape work (projection/teardrop knobs).
