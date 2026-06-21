---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - src/geometry/sdfFigure.ts
  - public/ai/figure.md
  - public/catalog/*.partwright.json (9 figures re-baked)
---

## Human

The areola has a bit of an edge. Rather than coming out like a disk could it
slope or extrude more gradually?

## Assistant

The hard `intersect` with the scoping cylinder left a `t`-tall vertical wall at
the disc rim — the visible edge. Switched the clip to `smoothIntersect(col,
size·0.7)` so the rim rolls off: the conformal offset now tapers from its proud
centre gradually back into the skin, reading as a gentle dome instead of a
flat-topped disc. The nipple plug likewise uses `smoothIntersect(col, nipR)` so
it's a rounded bump, not a pin. Center proudness is unchanged (≈t), so paint
stays clean (verified colored bake: solid areola, soft natural edge, no dither);
the rim's soft colour fade is actually more lifelike. Re-baked all 9; comp=1,
manifold, areola resolves.
