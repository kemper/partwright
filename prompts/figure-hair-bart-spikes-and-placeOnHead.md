---
date: 2026-06-13
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/figure_princess.js
  - public/catalog/rocker.partwright.json
  - public/catalog/superhero.partwright.json
  - public/catalog/princess.partwright.json
---

## Human

"the spikey hair is still kind of crazy. I would think spikey hair on a model
like this would be better if it was like, bart Simpson head spikey but hair
colored. also, the princess no longer had scalp showing but her crown doesn't
sit on the hair. it's embedded. much like the hands having a grip location,
should we have a way of attaching hats and crowns and things where they don't
embed or overlap too much with the hair?"

## Assistant

**Spiked → Bart-style.** The tousled-mop version read as chaotic; the
ring-of-thin-capsules before that read as a tiara. Reworked spiked into a clean
crown of 9 tall triangular spikes — fat cones (a cylinder `.taper()`-ed to a
near-point, oriented with the existing `eulerAlignZ`) ringing the crown plus a
center spike so the whole top is hair, no smooth bald dome. Regular and clean
(`Bart Simpson spiky`), hair-coloured by the caller's `.label('hair')`. Steep
(`up·2.3 + radial`) so tips dominate the silhouette. Deterministic, stable bake.

**`F.placeOnHead` — the headwear grip-frame analog.** The user's framing was
exactly right: `placeAt` snaps to the *skull* crown joint, so any hat/crown
embeds because the hair adds volume above the skull. New helper takes the hair
as `opts.rest`, rests the accessory's bbox anchor on the hair's TOP (centred on
the head), with `clearance` to float and `embed` to sink-for-weld. Added to the
`FigureNamespace` interface + wiring, documented in figure.md, unit-tested
(rest-on-top, embed/clearance, crown-joint fallback, input validation).

**Princess crown.** Refactored from hand-placed-into-the-skull to a coronet
built at the origin and seated with `placeOnHead({ rest: hair, embed })`.
Learned the weld constraint the hard way: a ring sized to the skull floats
*around* the narrower hair apex (2 components). Swept crownR/embed to land on a
small coronet (0.46·headX) that overlaps the hair surface and welds to one
piece. Re-baked rocker, superhero, princess — all manifold, one component,
under the tri budget.
