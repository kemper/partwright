---
date: "2026-06-12"
task: "fix: redo 8 catalog models — recheck all issues"
files_changed:
  - public/catalog/d20_die.partwright.json
  - public/catalog/geodesic_lantern.partwright.json
  - public/catalog/ringed_planet.partwright.json
  - public/catalog/pacman_ghost.partwright.json
  - public/catalog/spiral_staircase.partwright.json
  - public/catalog/castle_tower.partwright.json
  - public/catalog/royal_crown.partwright.json
  - public/catalog/treasure_chest.partwright.json
  - src/main.ts
---

## Human

All 8 catalog models from the prior run had multiple issues: missing thumbnails, D20 raised numbers should be carved, 4 models (spiral staircase, royal crown, treasure chest, castle tower) opened as blank sessions, geodesic lantern had no way to place a light inside, ringed planet had paint artifacts, ghost eyes were protruding, ghost wasn't parameterizable, spiral staircase had no exit at top.

## Assistant

Root cause for blank sessions: models with `api.surface.*` calls hung during import because `importSessionPayload` runs `runCodeSync` in the thumbnail callback, which triggered the surface Worker for heavy voronoi/knurl computation (>60s, never completing).

**Fix applied to `src/main.ts`**: Added `skipSurface?: boolean` option to `runCodeSync`. The `importSessionPayload` thumbnail callback now passes `{ skipSurface: true }` so surface computation is deferred to the first interactive load. This unblocked all 4 failing models in 2–4s.

**Per-model fixes**:
- **D20**: Rewrote with carved (subtracted) 7-segment numbers at ENGRAVE=0.55mm depth. Added thin gold fill plates (FILL_D=0.25mm) at the cavity floor, labeled 'numbers' with gold color (#d4a017). Body midnight blue (#1a2a6c). Fills scaled 1.08× to grip cavity walls.
- **Geodesic lantern**: Removed solid amber sphere fill. Replaced solid hex base with open hex ring base (inner opening for tea light/LED access).
- **Ringed planet**: Removed 0.8mm slab overlap causing double-triangle artifacts. Used fresh `Manifold.sphere` per band, 0.01mm epsilon for watertight boundary.
- **Ghost**: Eyes repositioned flush to body surface. Added `api.params` for bodyColor, eyeSize, toothCount.
- **Spiral staircase**: Added EXIT_START=330°/EXIT_END=30° gap in balusters and handrail for stair exit at top.
- **All 8 models**: Generated thumbnails from headless model:preview iso-view quadrant (sharp crop → 500×500 PNG base64).
