---
date: 2026-06-12
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_princess.js
  - public/catalog/rocker.partwright.json
  - public/catalog/superhero.partwright.json
  - public/catalog/princess.partwright.json
---

## Human

"I can see the scalp through the part for the waving princess. the spike hair
also doesn't really make sense. I kind of looks like a hair crown or something.
can you iterate?"

## Assistant

Two geometry fixes.

**Part groove cut to the scalp.** The groove box's bottom face landed *below*
the skull surface (z = headZ), so along the part the subtract removed all hair
down past the scalp and exposed skin. Fixed by pinning the groove bottom to
`headZ + tv*0.45` — above the skull — so only the top fraction of the cap shell
is skimmed and the part can never reveal skin. Also dropped the center part
from the princess: a part on cartoon long hair is fussy and low-value, and
plain `long` + `wavy` is the cleaner royal look. The part feature stays (now
safe) for callers who want it.

**Spiked read as a crown.** The old version placed 8 spikes on an even ring of
fixed-angle directions, which looked like a spiky tiara. Reworked to a tousled
mop: 13 spikes whose roots are spread across the whole crown and whose
directions are dominated by +up with a small, deterministic-pseudo-random
lateral/fore-aft tilt and varied length. Now reads as messy anime/punk hair.
Bake stays stable (sine-hash, not RNG).

Re-baked the three affected figures (rocker, superhero, princess) — the others
don't use `spiked` or `part`, so they're untouched. All three: manifold, one
component, under the tri budget.
