---
date: 2026-06-13
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - examples/figure_sumo.js
  - examples/figure_toddler.js
  - examples/figure_grandpa.js
  - examples/figure_yoga.js
  - examples/figure_diva.js
  - public/catalog/{sumo,toddler,grandpa,yoga,diva}.partwright.json
  - public/catalog/palettes/{sumo,toddler,grandpa,yoga,diva}.json
  - public/catalog/manifest.json
---

## Human

"I didn't want a single catalog item of mannequins. I want 4 or 5 new catalog
entries. or, I want existing models updated to use the new proportions."
(Reaction to the earlier Body-Type Lineup mannequin entry.)

## Assistant

Dropped the mannequin lineup and added FIVE distinct posed/clothed/painted
character figures, each spotlighting one of the new anthropometric axes:
- Sumo Wrestler — `weight:1` + male + stocky (the belly/bulk),
- Toddler with Teddy — young `age` + low headsTall, cradling a teddy,
- Grandfather with Cane — old `age` + lean, a held cane fused to the base,
- Yoga Tree Pose — `female`, lean, balancing,
- Opera Diva — `female` + `weight:0.62`, fuller figure in a gown.

Delegated the authoring to three parallel `model-sculpt` subagents (each owns
the render→adjust loop on distinct example files, returns text + labels +
palette), then baked all five sequentially myself (single-writer; the agents
never touch git). All five pass the gates: isManifold, componentCount 1,
≤~197k tris.

Hand-polished the grandfather afterward — the agent's `spine.lean:14` +
`head.pitch:8` made the default iso thumbnail read as a hunched faceless blob;
eased to lean 9 / pitch −5 so the face and cane read from any angle. Dropped
the `hair` label from his palette (he's bald → it paints 0 triangles).

Note for next time: when a figure is meant to be seen in the catalog, sanity-
check the **default iso thumbnail angle**, not just front/iso previews — an
extreme stoop can look fine head-on and terrible at 45°.
