---
date: 2026-06-13
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - examples/figure_body_lineup.js
  - public/catalog/body_lineup.partwright.json
  - public/catalog/palettes/body_lineup.json
  - public/catalog/manifest.json
---

## Human

"Go ahead and make a lineup of figures in the catalog and add them to the PR"
(on top of the #617 age/weight/sex rig work, to make the new axes visible in
the catalog).

## Assistant

Added one catalog entry — "Body-Type Lineup" — rather than several separate
figures: a single printable piece showing five figures off the same rig (child,
lean woman, average adult, heavyset man, older adult) standing on a shared base
bar. One entry reads as a deliberate comparison and keeps the catalog tidy.

Implementation notes:
- A `person(opts, x, hairStyle)` helper builds each figure at the origin then
  translates it to its slot; heights vary too so it's a real range, not just a
  proportion sweep.
- Caught a real gotcha: `F.faceDetail(rig)` centers the detail spheres on the
  rig ORIGIN, but each figure is translated by `x` — so the detail had to be
  rebuilt with the center offset by `p.x`, else the fine head mesh lands on the
  wrong (or no) figure. Used one head sphere per figure (5 regions, under the
  16-region cap).
- Feet sink into the base bar so the whole lineup is ONE connected component
  (`componentCount: 1`, manifold) — prints in one piece. genus is high (15)
  from the open arm-torso gaps across five figures, which is fine for a display
  piece; isManifold is the gate.
- Baked at edgeLength 0.6 with coarse per-head detail → 192k tris (under the
  ~200k budget) for five figures. Palette: skin / hair / base.
