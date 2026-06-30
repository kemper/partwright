---
date: 2026-06-25
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - examples/figure_scholar.js
  - examples/figure_knight.js
  - examples/figure_noble_lady.js
  - tests/unit/figureAttachment.test.ts
  - public/ai/figure.md
  - public/catalog/scholar.partwright.json
  - public/catalog/knight.partwright.json
  - public/catalog/noble_lady.partwright.json
---

## Human

The scholar's belt STILL renders onto his arms (caught in the app, side view —
the front views I'd been verifying hid it). Three sessions of `occludeArms`
tuning failed. "I think part of the problem is we haven't figured out how to do
things like have a thing that could wrap around a torso but also be beneath the
arms, but still be flush with the body … maybe if the arms are rendered
separately and then welded to the shoulders." Investigate first, then — after I
picked it — build the parts-based body (Option A): named parts + accessories that
declare which parts they wrap.

## Assistant

**Root cause (not a tuning bug).** The figure is one big SDF union of fields. A
flush belt is `surface.round(clearance+thickness)` sliced to a band, and
`round()` is **isotropic** — it offsets every surface in `surface` outward
equally. When `surface = union(skin, coat, pants)` includes the sleeves, the
sleeves get dilated INTO the band, so the belt literally wraps each arm. No
amount of subtracting a dilated arm back (`occludeArms`) cleanly fixes a band that
was *built* around the sleeves — in a relaxed pose the arm hugs the body so
torso∪sleeve reads as one fat surface with no separable lobe to carve.

**Fix — garment PARTS (the user's "weld the arms on separately" intuition).**
- `buildTop`/`buildPants` refactored into `buildTopParts` → `{ all, torso,
  sleeves }` and `buildPantsParts` → `{ all, hips, legs }`. `all` is byte-identical
  to the old single-Node output (20+ catalog figures depend on the `F.clothing.*`
  return type, so the parts API is purely additive). The `torso`/`hips` panels are
  built with NO arm masses and NO sleeve/leg zone.
- New `F.garment.top/pants` (parted) + `F.parts(rig)` (bare body as named parts).
- A belt conforms to `union(top.torso, pants.hips)` — its `round()` now follows
  only the torso silhouette and **structurally cannot** reach a sleeve. New
  `band.clear` opt hard-subtracts the EXACT arm (`clear: F.arms(rig)`) as a
  guarantee — no tuned dilation allowance.

**Quantified the fix before baking** (sharedSolid over the SDF fields, in a unit
test): whole-clothed-body conform = 157 u³ arm overlap (wraps both sleeves);
torso-panel conform = 55 u³ (no sleeve-wrap — residual is internal/hidden inside
the sleeve); torso + `clear` = **0**. So the honest guarantee is torso-conform
(kills the visible wrap) + `clear` (kills the internal poke), not "conform alone =
0" (my first over-claim, corrected after the test caught it).

**Folded all three figures in + re-verified from the SIDE/BACK angles that hid
every prior failure** (the discipline lesson from the caught regression): scholar
belt, knight belt + cuirass (cuirass now offsets `top.torso.round()`, not
`all.round()`), noble-lady collar (conforms to `F.neck(rig)`, the bare neck
column, so it can't spread onto the shoulders/dress). All three: isManifold,
componentCount 1, no warnings. Catalog entries re-baked. `occludeArms` demoted to
legacy in figure.md.
