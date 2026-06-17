---
date: 2026-06-17
branch: claude/sharp-dijkstra-3anil1
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_expectant_mother.js
  - public/catalog/expectant_mother.partwright.json
  - public/ai/figure.md
  - tests/unit/sdfFigure.test.ts
---

## Human

The catalog's "Expectant Mother" figure has a thing that juts out of the bottom
of her dress, colored like the dress, visible between her legs. An earlier AI
session welded a cone onto the figure for the belly and a later one re-draped the
dress to mostly cover it, but this nub still pokes out. Investigate what's going
on and propose how to make it better — possibly a native "belly size" part of the
figure API so AIs don't hand-roll belly bumps from scratch.

## Assistant

Two distinct problems, both addressed.

**1. The dress-colored pendant — a builder bug, not this model's hand-rolling.**
Isolating the dress region showed its mesh floor at z ≈ 4.98, ~5 units BELOW its
own intended hemline (z ≈ 10). The culprit is `buildTop` (the `figure.clothing.top`
builder): its torso shell is a single ellipsoid whose vertical half-height is tied
to `hemZ` — `(j.chest[2] - hemZ) * 0.62 + r.chestY`. For a low dress hem that term
is large, so the ellipsoid grows tall and its rounded bottom tip plunges below the
hemline as a centerline pendant between the legs. It's part of the `.label('dress')`
region, hence dress-colored. The builder's hem plane was only applied to the
"coverage underlayer", never to the main shell, so nothing trimmed the tip. Fix:
clip the WHOLE garment to the hem plane, not just the underlayer — a no-op for
shirts (whose shell already ends near the hem) and a clean cut for dresses. The
dress floor moved 4.98 → 9.73 (the hemline); confirmed with chef (short hem) and
princess (low-hem dress) that nothing regressed.

**2. Native `belly` knob (the requested API improvement).** Added a `belly` (0..2,
default 0) rig option alongside `weight`/`bust`. Implemented inside the shared
`torsoMasses()` source so it can't drift: `belly` grows the abdomen ellipsoid
FORWARD (the −Y `b` semi-axis) strongly and its girth/height modestly, while
RAISING the centre in lock-step with the height growth so the swell's bottom never
descends toward the crotch — structurally preventing the very "drops between the
legs" failure the old hand-rolling produced. Because `torsoMasses` feeds both
`buildTorso` (the body, and the navel landmark in `buildRig`) AND the coverage
underlayer of `buildTop`, one knob makes the body swell, the navel ride it, and a
dress/top drape over the bump automatically. At `belly: 0` the torso is
byte-identical, so every existing figure is unchanged.

Refactored `examples/figure_expectant_mother.js` to use `belly: 0.7` and a plain
`figure.clothing.top` — deleting the hand-rolled `bellyDrape` ellipsoid and
`skirtOverlay` cylinder entirely. Re-baked the catalog blob
(`public/catalog/expectant_mother.partwright.json`) against its palette.

Verified: model:preview from multiple angles incl. the underside (no pendant);
the colored catalog bake (dress fully covers the torso/belly with no skin
showing through, legs below the hem are skin-colored, not dress); and loading the
regenerated catalog entry in the running app (renders the draped pregnant figure,
161k tris, manifold, one component). Added 5 unit tests for the `belly` knob
(defaults/range, forward growth + non-descending bottom, byte-identical at 0,
navel rides the swell, torso bulges forward). All 1457 unit tests pass; typecheck
clean. Documented `belly` in `public/ai/figure.md`.

### Follow-up (work-reviewer catch)

The first hem-clip applied `smoothIntersect(hemPlane)` to the WHOLE garment,
which also amputated sleeves that hang below a high hem (a sleeved crop/high-hem
top) — verified: a long-sleeve top at `hemZ:34` had its sleeve tubes sliced flat
at z=34 instead of hanging to ~26.9. The catalog expectant_mother
(`sleeve:'none'`) was unaffected, but it broke `buildTop`'s general contract.
Fix: clip only the shell + clavicle + coverage to the hem, then union the
sleeves in afterward (unclipped) — sleeves follow the arms and legitimately hang
below a high hem. For `sleeve:'none'` the path is identical to before, so the
committed catalog bake is unchanged. Re-verified: crop-top sleeves intact (floor
26.9), dress pendant still gone (floor 9.7), all 221 figure tests pass.
