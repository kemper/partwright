---
date: 2026-06-05
branch: claude/eager-faraday-6Rii5
files_changed:
  - public/catalog/manifest.json
  - public/catalog/creeper_head.partwright.json
  - public/catalog/pendant_lamp.partwright.json
  - public/catalog/pixel_heart.partwright.json
  - public/catalog/question_block.partwright.json
  - public/catalog/rangefinder_camera.partwright.json
  - public/catalog/space_invader.partwright.json
  - public/catalog/wall_clock.partwright.json
  - public/catalog/traffic_light.partwright.json
  - examples/rangefinder_camera.scad
---

## Human

Remove several bad catalog entries: the vintage rangefinder camera, the regular Space Invader, the pixel heart, the Super Mario ? block, the creeper head, the pendant chandelier, and the BREP wall clock (it has colour distortion). Also: the traffic light in the catalog is facing the wrong way — reverse it.

## Assistant

Two independent changes to the static `/catalog`.

Removals: each gallery tile is a self-contained `public/catalog/*.partwright.json` listed in `manifest.json`. Deleted the seven payload files and their manifest entries. The "vintage rangefinder camera" maps to the `rangefinder-camera` entry — distinct from the unrelated `vintage-camera` tile, which stays. The standalone `space-invader` goes, but the arcade-cabinet tile (which has an invader on its screen) stays. The BREP wall clock is the `replicad`-language `wall-clock`, distinct from the manifold-js `clock-face` ("Wall Clock Face"), which stays. Also removed `examples/rangefinder_camera.scad`, which is surfaced as an editor example via `import.meta.glob('../examples/*.scad')`, so the same bad model wasn't left reachable there. Verified no other source/script references the removed ids or files.

Traffic light facing: the catalog tile renders the latest version's *baked thumbnail*, so a code-only change wouldn't update the visible tile. The model builds its lensed face on +Y, which points away from the catalog camera (the original thumbnail showed only the dark housing back). Fix: append `model = model.rotate([0, 0, 180])` before the final return — a 180° spin about the vertical Z axis reverses front/back while preserving the red-amber-green top-to-bottom order and the z=0 rest plane. Regenerated the entry with `scripts/single-catalog-entry.cjs` to bake a fresh thumbnail. Reproduced the original paint via a `paintByLabels` file carrying the exact six `byLabel` colours pulled from the old `colorRegions` (those descriptors are label-bound, so they survive the rotation). Restored the original manifest description so the diff stays scoped to geometry. Confirmed the new thumbnail shows the lenses/visors facing the camera; `npm run build` + `npm run test:unit` green.
