---
date: 2026-06-14
branch: claude/mouth-options-expansion-2ua421
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/faces/bust_grin_teeth.js
  - examples/faces/bust_natural_lips.js
---

## Human

The figure mouth options are very basic. There's a GitHub issue about corruption
when a mouth is carved into the head. Wanted: more mouth options — natural lips
with a distinct upper and lower lip; smiles that show teeth (upper, lower, or
both); frowny / neutral / smile / big-smile presets ("levels"). Flat / painted-on
mouths are acceptable for now (carving can come later). Key print constraint:
avoid freestanding teeth, because support material would have to go inside the
mouth. Plan and implement an upgrade to the figure-API mouths.

## Assistant

Scoped with the user to **painted-flat first, one cohesive PR**. Kept the design
additive + paint-labelled so it prints support-free and sidesteps the carve
corruption (#652) entirely; the historical carved-smile default stays
byte-identical, all new capability is opt-in.

**Expression axis (the headline).** The old `'smile'` line hardcoded
`curl·(t²−0.3)`, which *always* lifts the corners — no frown was possible. Added
a signed `curve` (−1 frown … +1 smile) plus an `expression` preset enum
(`bigSmile … deepFrown`). Generalized the line profile to `grooveCurl·bend·(t²−0.3)
+ smirk·…`; `bend=1` reproduces the old smile exactly (calibration anchor), `0` is
straight, `<0` frowns. `resolveMouthCurve` returns `undefined` when neither
`curve` nor `expression` is set, so each style keeps its historical bend — un-set
mouths are byte-identical. The bend also bows the lip ridge and the open-mouth lip
ring.

**Natural two-lip lips.** `style:'lips'` gains `divided:true` → a distinct upper +
lower lip (two bowed capsule arcs with a seam). The non-divided, no-curve path is
preserved verbatim (single straight ridge) for back-compat.

**Teeth.** `mouthAccents` `teeth` now takes `'upper'|'lower'|'both'` (plus the
back-compat `true`=upper / `false`). Added a lower band (vertical mirror of the
existing upper band). Under `render:'painted'` the teeth are a flat plate sitting
**flush/proud in the lip-ring opening** and **fused into the head** (no cavity, no
internal overhang → no support inside the mouth). The carved path keeps the
recessed-behind-the-rim band.

**#652 fix (carved-mouth tearing on small heads).** Added `render: 'auto' |
'carved' | 'painted'`. `auto` carves only when `carveIsSafe(rig)` — an *absolute*
groove-size floor (`r.head·0.07 ≥ 0.245`, i.e. `r.head ≥ 3.5`), because the
groove-to-march-cell ratio is scale-invariant (~3.5 at any head) so only an
absolute floor separates a clean carve from a torn one. Below it `auto` paints a
clean additive ridge. Verified the exact #652 Yoga repro: `minEdgeLength` went
0.0002 (torn) → 0.004, manifold, one component, no warnings. Back-compat: standard
`headsTall:5` figures (`r.head≈6`) still carve unchanged.

`mouthAccents('smile')` now returns a paintable lip *line* labelled `'lips'`
(was: threw) so a coloured expressive mouth line is possible.

**Verification.** `model:preview` (real engine, Node): the colored expression
spectrum reads deep-frown→big-smile; the painted grin shows white teeth framed by
red lips (teeth/lips labels resolve to real triangles only after the double-ring
fix — pass `mouth:false` to assemble when using accents, mirroring the existing
`'lips'` guidance); the divided lips render as a clear pout. Confirmed the painted
grin builds manifold/1-component in the real browser too. `minEdge 0` on some
busts is pre-existing (the plain default baseline shows it; genus 0, no warning) —
not introduced here. 175 figure unit tests + full unit tier green; preflight exit
0 (no circular deps).

Issue hygiene: this resolves #652 (additive auto-fallback) and chips at #589's
lips/mouth gaps; the deferred **deep carved-cavity teeth with upper/lower gum
separation** is filed as a follow-up rather than forced into this print-safe pass.

**Review follow-up (work-reviewer):** two should-fix items addressed. (1) The
`auto` carve floor was `r.head ≥ 3.5`, which flipped mainstream 60-unit
`headsTall:8` adults (`r.head ≈ 3.45`) from carved to additive — not just the
Yoga-class edge. Re-calibrated empirically to `grooveR ≥ 0.21` (`r.head ≥ 3.0`):
the documented #652 Yoga repro (2.82) and very-lanky `headsTall:10` (2.76) still
flip to the clean additive mouth, while every height-60 figure (`headsTall` 5–8)
keeps carving exactly as before. Added a regression test pinning the adult case
to `'carve'`. (2) `divided` was coerced (`=== true`) instead of validated; now
uses `assertBoolean` and rejects non-booleans, matching the other mouth fields.
