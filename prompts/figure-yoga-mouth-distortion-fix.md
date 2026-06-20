---
date: 2026-06-13
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - examples/figure_yoga.js
  - public/catalog/yoga.partwright.json
  - public/catalog/palettes/yoga.json
---

## Human

Reported (with a screenshot) that the Yoga Tree Pose figure's mouth had torn /
distorted geometry; suspected it was unrelated to the axes work.

## Assistant

Reproduced on a head-only build: the carved mouth groove meshes into degenerate
slivers (minEdge 0.0002, visibly torn) on this figure's SMALL head — height 46
at headsTall 7.5 gives r.head ≈ 2.8, so the mouth is the tiniest face feature
and the smirk cutter falls below clean grid resolution. Confirmed it's the carve
(mouth:false is clean) and that no carved-mouth param (smirk 0, wider, finer
mouthEdgeLength) avoids the sliver — finer detail made it worse.

Fix scoped to the figure: switched to an ADDITIVE lip ridge
(`mouth: false` in `face.assemble` + `F.face.mouthAccents(rig, { style:'lips' })`,
like the Opera Diva), which doesn't carve and stays visually clean — and reads
as a calmer, fitting expression for a yoga pose anyway. Added a `lips` color to
the palette and re-baked (manifold, one component, 142k tris).

Underlying issue (left for a separate, broader fix): the carved-mouth path
produces torn geometry at small head sizes / high headsTall regardless of
params — the mouth detail sphere doesn't rescue it. Worth a face-system fix
(e.g. a minimum mouth-feature floor or a cleaner cutter) but out of scope here.
