---
date: 2026-06-18
component: catalog (shod figure entries)
---

## Human

(Follow-up to the figure-footwear resize fix, PR #737.) The catalog grid shows
baked thumbnails/geometry; re-bake the shod figures so the fix is visible there.
User chose: do it as a separate PR.

## Assistant

PR #737 resized `buildFootwear` to the reshaped foot, but catalog
`.partwright.json` entries store **baked** geometryData + thumbnails, and the
example *source* didn't change (only the builder did) — so nothing auto-rebakes.
Re-baked the 14 shod entries against the current engine.

Approach — faithful, in-place re-bake (`scripts/rebake-shod-figures.cjs`): for
each file, re-run the version's own stored `code` through `window.partwright`,
replay its paint regions (all 14 use pure `byLabel` descriptors, so
`paintByLabel({label,color,name})` in `order` reproduces the exact colours), save
a version, then splice ONLY `geometryData` + `colorRegions` + `thumbnail` back
into the existing payload. `code`, `notes`, `appVersion`, `session`, `parts`,
labels, names are preserved byte-for-byte, so the diff is just re-baked geometry.
Rendered at the standard 30°/45° hero camera (matching the existing thumbnails,
per the prior figure-rebake prompt log).

Verified: all 14 re-bake manifold, single-component, every paint region replayed
without error, region counts unchanged, and a colour-by-label comparison shows
the palette is identical pre/post. Before/after thumbnail montages for the
sprinter (club shoe → compact sneaker) and superhero (long boots → proportional
boots) confirm the fix shows in the actual catalog renders, colours intact.

Entries re-baked: sprinter_start, athlete, soccer_striker, superhero,
basketball_dunk, danseur, cheerleader, elf_archer, gardener, pixie_skater,
rock_climber, runway_model, weightlifter, archer.
