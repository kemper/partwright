---
date: 2026-06-19
branch: claude/clever-hypatia-eyspgw
files_changed:
  - public/catalog/locs_musician.partwright.json
---

## Human

Re-bake the locs-musician catalog entry now (the rest of the catalog re-bakes in
a separate PR) so its catalog snapshot shows the fixed nose + sculpted default
lips.

## Assistant

Re-baked `public/catalog/locs_musician.partwright.json` from the updated
`examples/figure_locs_musician.js` via `scripts/build-catalog-entry.cjs` under
xvfb, with the committed `palettes/locs_musician.json`. Result: manifold,
componentCount 1, 328,678 tris, genus 46 — the fixed `buildNose` (no torn
nostril crater) and the new sculpted default `style:'lips'` mouth bake into the
shipped entry. The remaining ~40 figures re-bake in the separate catalog PR
tracked in #771.
