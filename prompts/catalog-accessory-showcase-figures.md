---
date: 2026-06-21
branch: claude/admiring-goodall-1tlwna
files_changed:
  - examples/figure_knight.js
  - examples/figure_scholar.js
  - examples/figure_noble_lady.js
  - public/catalog/manifest.json
  - public/catalog/bake-manifest.json
---

## Human

Can you add some figures to the catalog that demonstrate all of these [accessory]
features?

## Assistant

Added three catalog showcase figures (self-coloured via in-code `api.paint.label`
so they bake with no palette file), covering the attachment modes:

- **Knight** — Worn (plate cuirass + pauldrons), Ringed (belt), Held (sword in
  the fist via `F.holdAt`), Hung (scabbard at the hip via `F.hangFrom`).
- **Scholar** — Perched (round eyeglasses via `F.onFace`), Crowned (wide-brim hat
  via `F.placeOnHead`), Ringed (belt).
- **Noble Lady** — Marked (in-code makeup: blush + lipstick + eyeshadow), Ringed
  (gold choker via `F.ring` on `rig.ring.neck`) + a hung pendant.

Each: authored `examples/figure_*.js`, baked via `build-catalog-entry.cjs`
(headless, dev server up — no palette flag), registered in `bake-manifest.json`
(source + gates) and `manifest.json` (figures tag). All manifold, one printable
piece; `lint:catalog` clean.

**Finding — `F.strap` (Slung) isn't showcase-ready.** I tried a satchel on the
Scholar and a sash on the Noble Lady; both BURIED (`sash` label → 0 triangles).
`F.strap` bows a tube forward from joint to joint, but the endpoints sit inside
the body and the band ends up under the clothing rather than lying across it. It
needs **surface-routing** (place endpoints on the body surface + follow the chest
contour) before it reads as a worn strap — filed as the next attachment follow-up.
So Slung is the one mode not yet demonstrated in the catalog; the other seven are.
Makeup placement is also rig-specific (the cheek box that worked at headsTall 6
missed at headsTall 7 until widened in depth), another reason a future
`api.paint.sphere`/surface-relative selector would help.
