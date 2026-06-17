---
date: 2026-06-17
branch: claude/figure-api-ears-u5gk6c
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/figure_elf_archer.js
  - examples/faces/bust_elf.js
---

## Human

The pointy (elf) ear is like a straight point. It should be more triangular /
slope up to a rounded point. Also add a tilt argument so it can angle back a bit.
And show more previews with hair from the side.

## Assistant

The `'pointed'` ear was a thin capsule spike welded onto a rounded pinna — it
read as a straight spine, not an ear. Rebuilt it as a leaf/teardrop: a stack of
ellipsoids that narrow (front-back) and shrink as they rise, drifting slightly
back (+Y), so the silhouette is a broad triangle sloping up to a *rounded*
point. Verified the shape from a true side profile before porting.

Added a `tilt` option to `F.face.ears` (degrees, −45..45, + = back). It rotates
the local ear about its lateral axis before the X-mirror/pose, so both ears
sweep back symmetrically (the rotation lives in the YZ plane the mirror leaves
untouched). Default 0 → every non-tilted ear is byte-identical, and `tilt` only
binds on top of the chosen type, so `'round'`/`'detailed'` figures are
unchanged. Applied a modest tilt (20–22°) to the elf archer + elf bust to
showcase it, and re-baked just those two (the only `'pointed'` entries).

Unit test: tilt pushes the elf point's max-Y toward the nape and rejects
out-of-range. Docs updated (assemble block, ear table, namespace JSDoc).
Verified: typecheck, 224 figure unit tests, lint:deps, and headless previews of
the three types with hair from side angles + the tilt sweep.
