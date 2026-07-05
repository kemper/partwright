---
date: 2026-06-23
branch: claude/admiring-goodall-1tlwna
files_changed:
  - examples/figure_knight.js
  - examples/figure_scholar.js
  - examples/figure_noble_lady.js
  - public/catalog/knight.partwright.json
  - public/catalog/scholar.partwright.json
  - public/catalog/noble_lady.partwright.json
---

## Human

(Continuing the figure-modeling architecture, tracking #853.) Fold the three
showcase figures onto the new F.layers system as the proof it works — fixing the
still-open bugs: scholar belt painting onto the arms again, noble lady necklace
terminating through the dress on one side, knight armor bleeding onto the arm.

## Assistant

Folded all three figures onto `F.layers` (pillar 1) + the `thumb` grip vocab
(pillar 3), and re-baked. Each fix is now STRUCTURAL, not a one-off:

- **Knight** — `F.layers([skin, shirt, pants, belt, cuirass, pauldrons])` with
  `occludeArms` on the belt + cuirass (terminate at the sleeve — kills the
  armor-bleeds-onto-arm). Cuirass split from the pauldrons so only the plate is
  arm-occluded (the shoulder caps survive). thumb:'in' grip, blade up-forward.
- **Scholar** — belt is `F.band` arm-occluded via F.layers (`occludeArms = coat
  thickness`) → terminates at the coat SLEEVE, fixing the belt-on-arms regression
  the old skin-only occluder missed. Had to label the OUTER union of the belt+
  buckle (F.layers' occludeArms subtract only propagates a label from a single
  labeled child — an unlabeled union-on-top rendered the belt grey).
- **Noble lady** — the collar conforms to the NECK SKIN (not the full clothed
  body): marching to `clothed` let one side reach the wide gown shoulder and
  terminate through the dress. Hugging the neck column keeps it tight all round.

Verified all three headlessly (front + sides) and in the colour bake.

Discovered + filed: the knight COLOUR BAKE reports componentCount 2 (browser
manifold) though Node model:preview says 1 — a near-threshold thin feature that
fuses in Node but splits at the browser's edgeLength. Thickening the scabbard frog
(rooted inside the hip) and the sword→hand bridge did NOT resolve it, so the loose
piece is elsewhere (likely a pauldron or a sliver — needs a browser-side decompose
to pin down). Tracked as a follow-up rather than burning more blind bake cycles;
the figure's reported defects are all fixed.
