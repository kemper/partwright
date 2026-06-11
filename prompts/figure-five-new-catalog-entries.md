---
date: 2026-06-11
branch: claude/hopeful-franklin-6ucma0
files_changed:
  - examples/figure_karate.js
  - examples/figure_superhero.js
  - public/catalog/sitting_reader.partwright.json
  - public/catalog/karate.partwright.json
  - public/catalog/princess.partwright.json
  - public/catalog/rocker.partwright.json
  - public/catalog/superhero.partwright.json
  - public/catalog/manifest.json
---

## Human

(Same session.) Bake the five new figures into catalog entries and add them
to the manifest.

## Assistant

Three entries baked clean on the first pass. Two failed the
every-label-resolves gate exactly as the bake script's paint step is
designed to catch:

- karate + superhero: the 'eyes' sclera (and karate's 'pupil') resolved to
  0 triangles. The eye dome's protrusion (0.28 × radius) is ~1 face-detail
  march cell at the default sizes — marginal everywhere, and these two
  landed under it. Fix: eye radius up to r.head * 0.17 (the kid/strongman
  value), confirmed with the headless paint-op probe before re-baking.
- karate's headband was the deeper cause of its dead eyes: the agent had
  lowered the band to eye level — a blindfold. Raising it to the forehead
  then raised genus 2 → 5 because the band's back half GRAZED the hair-cap
  shell from just inside. Final fix pins the band centerline ON the hair
  surface (skull + hair thickness) with a fatter band so it crosses the
  shell transversally — genus 3 (belt ring + headband ring are legitimate
  handles).

Final gates, all five: 1 component, manifold, genus ≤ 3, every label
painted (reader 10, karate 11, princess 9, rocker 11, superhero 12),
158k–203k triangles. Manifest gains five entries appended in catalog
format; thumb camera az 25 / el 12 to match the figure family.
