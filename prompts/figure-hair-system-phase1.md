---
date: 2026-06-12
branch: claude/vibrant-hopper-j3xpuf
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/figure_afro_funk.js
  - public/catalog/afro_funk.partwright.json
  - public/catalog/afro_funk.thumb.png
  - public/catalog/palettes/afro_funk.json
  - public/catalog/manifest.json
---

## Human

"Scan the GitHub issue related to figurine improvements. I'd like to start on
a new phase of making them better." Picked issue #619 — the first-class hair
system (separable, printable, relief-textured styles) — from the figure-API
issue cluster (#589 umbrella + #615–#620).

## Assistant

Scoped this as **phase 1** of #619: expand the styles and add print-native
relief texture, deferring the weld/separate-part split and the post-bake
surface-relief-modifier route to a follow-up (noted in the PR). Decisions:

- **Texture is in-SDF `.displace()`, not the bake-path relief modifiers.**
  `buildHair` returns an SDF `Node`; the fur/fuzzy/woven/voronoi modifiers
  operate on an already-baked mesh, so they can't run inside the builder.
  Displacement along the head frame is the SDF-native equivalent — the
  "strand-displacement pass" #589 anticipated — and stays one watertight
  component. Amplitude is floored at `max(r.head*0.06, 0.18)` so the relief
  survives meshing instead of aliasing (the recurring sub-cell-feature
  lesson). Three fields: `strands` (vertical grooves combed around the head),
  `wavy` (low-freq vertical waves, default for braids), `curls` (isotropic
  3-axis bumps, default for afro).
- **New styles `bob`/`afro`/`braids`/`spiked`; new opts `length`/`volume`/
  `part`/`texture`.** All four new options are neutral at their defaults
  (`length:'mid'`→lenMul 1, `volume:1`, `texture:'none'`, `part:'none'`), so
  the five classic styles render byte-identical and the existing catalog
  bakes never drift — pinned by a unit test that diffs `evaluate()` at probe
  points between bare and explicit-default calls.
- **`part` is a shallow subtract, not a full cut.** A parting groove dents
  the crown only (z-extent kept above the scalp) so the cap can't split into
  two components.
- **The bald-bbox bug from the issue was already fixed on main** (sub-cell
  sphere parked at the head centre, with a test) — confirmed, no change.
- **Catalog example:** a funk dancer with a `volume:1.5` afro and a cocked
  head, so the tile demonstrates both the curl relief and that hair tracks
  head pose. Tuned the faceDetail edgeLength coarser (curls inside the fine
  head sphere were blowing the ~200k tri budget → 158k). Baked with a genus
  gate (`--max-genus 8`) and a label gate; verified `isManifold`,
  `componentCount: 1` across every new style via `model:preview`.
