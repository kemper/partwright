---
date: 2026-06-07
branch: claude/voxel-rotate-and-catalog-comments
files_changed:
  - src/geometry/voxel/grid.ts
  - tests/unit/voxel.test.ts
  - public/ai/voxel.md
  - public/catalog/voxel_knight.partwright.json
  - public/catalog/vintage_camera.partwright.json
---

## Human

Follow-up to the Front = −Y convention work: make two improvements in a new PR —
(1) clean up stale/misleading orientation comments in catalog entries, and
(2) add a voxel rotate/mirror helper so voxel models can be reoriented.

## Assistant

Context: after restoring Front = −Y (PR #476), I triaged all 10 "+Y"-flagged
catalog entries by rendering each from both iso corners and, for the ones with a
face, a definitive front(az0)/back(az180) ortho pair. Every entry is already
correctly oriented for −Y — the grep hits were stale comments and build-time
scaffolding, not real misorientation. So no geometry needed changing; this PR is
the two cleanups the triage surfaced.

**1. Voxel `rotate` helper.** The grid already had `translate` and a (duplicating)
`mirror`, but no way to *reorient* — which is why a voxel model built facing the
wrong way couldn't be fixed without rewriting every coordinate. Added
`VoxelGrid.rotate(axis, degrees)`:
- Restricted to multiples of 90° (the only angles that keep voxels on the integer
  lattice) — throws a `ValidationError` otherwise. Negative/over-360 normalized.
- Exact integer cos/sin (no float rounding); right-hand rule; about the origin
  (consistent with `translate`/`mirror` — `translate` first to pick a pivot).
- Rebuilds the cell map like `translate`; out-of-range cells past the asymmetric
  grid edge are dropped, same as the existing transforms.
- 4 unit tests (180° +Y→−Y with color preserved, per-axis 90° right-hand checks,
  4×90°=identity reversibility, non-90° rejection + negative normalization) and a
  browser check (red +Y marker → faces −Y front after `rotate('z',180)`).
- Documented in the voxel.md transform table.

**2. Catalog comment cleanup.** Two entries had orientation *summaries* that
contradict their actual geometry (verified against coordinates, not just renders):
- `voxel_knight`: header said "front features on +Y / FRONT = max Y", but the
  visor/eyes/shield are built at y=−4/−5 (voxels can't rotate, so it's built
  directly in final coords — the header was just wrong). Fixed the header and the
  handful of inline "(+Y)" tags sitting on −Y coordinates.
- `vintage_camera`: the summary asserted the front face "is +Y", but the code
  flips +Y→−Y at the end, so the lens lands on −Y. Reworded to say it's built on
  +Y and flipped; left the (accurate) build-space +Y notes alone. Both versions
  carry the same code, so both were updated.

Edits were raw-text replacements of comment substrings with uniqueness assertions;
verified the executable code (comments stripped) is byte-identical, so geometry is
untouched. Left entries whose +Y references are correct-in-context (build-then-
rotate like robot_buddy, or symmetric models) unchanged.
