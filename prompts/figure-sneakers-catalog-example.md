---
date: "2026-06-13"
task: "feat: add Sneakers Character catalog example showcasing the footwear builder"
pr: 634
areas: [figure, catalog, examples]
---

## Human

Make some new examples in the catalog that showcase the [footwear] technique and make sure they look really good.

## Assistant

Added `examples/figure_sneakers.js` — a casual standing character in chunky sneakers, built to show off the reshaped footwear:

- `F.clothing.shoes(rig, { label: 'sneaker', sole: { overhang, thickness } })` — the upper and the contrasting sole paint as separate regions (white sneaker + red sole in the palette).
- `F.ground(rig, { mode: 'plant' })` so both feet share one plane and the soles sit flush on the base.
- Slim jeans + short-sleeve tee + short hair + friendly face, on an auto-sized base.

Verified `isManifold: true`, `componentCount: 1`, no warnings; checked the colored bake from iso + side (white sneakers with red soles and a clean toe-spring profile read clearly). Added the committed `.partwright.json`, a palette, and a manifest entry. `lint:catalog` OK (124 KB), preflight green (1297 tests).
