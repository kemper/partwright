---
date: 2026-06-14
branch: claude/figure-api-ears-u5gk6c
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/ai/figure.md
  - examples/figure_elf_archer.js
  - examples/figure_topknot_sensei.js
  - examples/figure_pixie_skater.js
  - public/catalog/manifest.json
  - public/catalog/bake-manifest.json
---

## Human

Add ears to the figure API to give the models more anatomy. None of the figures
have proper ears. Support different ear types, and handle the relationship where
hair sometimes goes over the ears and sometimes behind them. Investigate the
current API, render preview images of ear types under consideration, capture the
direction in a plan file, implement it, add a few full-body catalog figures with
ears, and open a PR.

## Assistant

`buildEars` was a single flat ellipsoid blob per side, world-axis aligned
(ignored head pose), with only a `size` option — and the hair cap's radius
(`headX + tv`) sat at roughly the ear's outer edge, so hair silently buried the
ears with no way to choose over-vs-behind. The ear anchors (`rig.face.earL/R`)
and the `orientToHeadPose(local).translate(anchor)` placement idiom already
existed.

Design (prototyped headlessly first): three ear **types** on
`F.face.ears`/`assemble` — `'round'` (default cupped disc + concha, a strict
upgrade over the blob), `'pointed'` (elf taper-to-a-point), `'detailed'` (pinna
+ concha + a helix-rim capsule arc + earlobe) — built outboard of the anchor so
they stand proud of the skull and oriented to head pose. The hair⇄ear coupling
is one enum on the part that owns the silhouette: `F.hair(rig, { ears })` —
`'cover'` (default, carves nothing → existing bakes byte-identical) vs
`'behind'` (scoops an ear-clearance pocket at each anchor so the skin ears
protrude in front).

Tests: ear-type geometry differs / rejects bad type / stands proud of the
skull; hair `'behind'` clears the ear zone while `'cover'` (and the existing
byte-identity probe, extended with `ears:'cover'`) leaves it filled; crown
untouched. Docs in `public/ai/figure.md`.

Three new full-body catalog figures, one per ear type, each with hair `'behind'`
so the ears read: elf archer (pointed + longbow fused to the fist), topknot
sensei (detailed + bun), pixie skater (round + cropped cut). While baking I hit
the classic "eyes resolve to 0 paintable triangles" trap — measured with an
`evaluate()` probe that the assembled brow/nose pushed the face surface ~1.3
units forward of the eye anchor, so the small eyeballs were fully buried; fixed
by trimming the over-aggressive `cheek`/`nose.bridge` and nudging the eyes
forward along `headForward`, then coarsening `faceDetail`'s eye edge-lengths to
hold the catalog tri budget. All three bake clean (1 component, manifold,
<200k tris, every label paints) and are wired into both catalog manifests.

Verified: typecheck, 1398 unit tests, lint:deps/deadcode, lint:catalog, build,
and headless `model:preview` renders of each ear type, the cover/behind
contrast, and the three figures.
