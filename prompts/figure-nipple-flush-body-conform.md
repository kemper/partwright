---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - src/geometry/sdfFigure.ts
  - src/geometry/sdf.ts
  - public/ai/figure.md
  - examples/figure_boxer.js
  - examples/figure_danseur.js
  - examples/figure_lotus_yogi.js
  - examples/figure_sprinter_start.js
  - examples/figure_strongman.js
  - examples/figure_sumo.js
  - examples/figure_surfer.js
  - examples/figure_swimmer.js
  - examples/figure_tai_chi_master.js
  - public/catalog/*.partwright.json (9 figures re-baked)
---

## Human

The surfer, tai chi master, and lotus meditation yogi all had errors where they
can't render at all. The boxer/guard has ridiculous giant nipples that pop off
like burger patties. The strongman nipples are still buried, the pool swimmer
and sumo wrestler partially buried. Maybe it's because they weren't rebaked.
They need to be either flush or nearly flush to the torso — I'm okay with total
flush if that's easiest. Whatever could possibly work, I want you to figure it
out and solve it. Fix the generic helper so all current AND future figures
benefit, not one catalog figure.

## Assistant

Two independent root causes, both fixed generically:

**1. Non-rendering figures (surfer / tai_chi / lotus) — detail-region cap.**
`MAX_DETAIL_REGIONS` in `src/geometry/sdf.ts` was 16. Faces grew `faceDetail`
to 14 sub-regions (eyebrows + ears), and a bare-chest figure adds foot (2) +
hand (2) detail = 18 > 16, which threw at build time. Raised the cap 16 → 24.

**2. Nipple seating — flush by construction instead of a proud coin.**
The previous approaches (sphere∩cylinder "coin", then pec-apex anchoring)
fought the surface: too far forward → "burger patty" protrusion (boxer); too
far back → buried/clipped (strongman, swimmer, sumo); and on low-muscle pecs
the anchor sat behind the real surface so a `sphere(size)` missed entirely
(0-triangle areola → unpaintable).

The fix makes the areola the body's OWN front surface. `F.nipples(rig, { on })`
takes the welded body Node and, for each anchor, intersects it with a forward
**cylinder column** (`sdf.cylinder(size, fwd+back).rotate([90,0,0])`): the
front cap is the real chest surface regardless of how deep the pec sits, the
back cap is bounded inside the body. The result is dead flush by construction —
no proud rim, no sunk disc — plus a deliberately tiny nipple nub
(`sphere(nipple)` nudged `nipR*0.5` outward) that reads as "nearly flush"
without protruding. Legacy callers (no `on`) keep the old coin path.

All 8 catalog sources that call the helper now pass `{ on: skin }`; strongman
keeps its hand-rolled puffed-pec areola but reworked to the same
`skin.intersect(sphere)` flush pattern seated on the real welded surface.

**Verification.** Rendered front-on chest crops of boxer/strongman/swimmer/sumo
(`model:preview --views front --size 1200` + sharp crop) — confirmed nipples are
subtle, nearly-flush discs, no burger patty, no burial. All 9 pass
`--require-labels areola` (label paints > 0 triangles), componentCount=1,
isManifold. Re-baked all 9 catalog entries (`build-catalog-entry.cjs`,
palette recovered from the existing bake; areola color added for danseur/
sprinter whose old palette lacked it) so the catalog shows the fix — the user
correctly diagnosed the stale catalog as "they weren't rebaked." Montage of all
9 thumbnails confirms every figure renders and seats flush.

Closes the detail-cap defect (#730) and completes the generic-flush-nipple work.
