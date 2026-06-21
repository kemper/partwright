---
date: 2026-06-18
branch: claude/charming-planck-5j7ic8
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - public/catalog/runway_model.partwright.json (re-baked)
  - public/catalog/princess.partwright.json (re-baked)
  - public/catalog/diva.partwright.json (re-baked)
  - public/catalog/witch_casting.partwright.json (re-baked)
---

## Human

The Runway Fashion Model catalog figure looks essentially topless (bare female
torso) and its "dress" is a poorly-welded cone shape. Fix the catalog entry —
but also explain why it turned out so poorly, and whether the API could have a
proper dress/clothing generator (or whether we already have one in main that
just never got applied to this figure). Investigate and report back.

## Assistant

**Root cause — a single off-by-`big` bug in `buildTop`, not a missing feature
and not a stale bake.** `figure_runway_model.js` already does the right thing
(`F.clothing.top(rig, { sleeve:'none', hemZ: height*0.06 })` for a floor-length
gown), and the entry was re-baked yesterday — so the broken geometry is current
`main`. The defect is in the engine: `buildTop` clips the finished garment to a
"`z ≥ hemZ`" half-space, but that half-space was a *finite* box of height
`big = max(chestX, upperArm)·8`. On a tall, slim figure the chest sits high in Z
(runway chest ≈ z 53) while `chestX` — hence `big` ≈ 37 — is small, so the box
TOP landed at `hemZ + big` ≈ 41.5 and `smoothIntersect` **amputated everything
above it**: the whole bodice, bust, clavicle, and the guaranteed-coverage
torso underlayer. What survived was just the lower bodice + skirt cone → a bare
torso over a megaphone. Confirmed empirically: rendering the gown geometry in
isolation returned a smooth cone with no chest, and a colored front bake showed
a fully bare torso. The amputation was 21.3 Z-units on runway.

**Fix (`sdfFigure.ts`):** size the hem half-space to actually clear the garment
top — `hemH = (zTop - hemZ) + big` instead of a flat `big` — so its bottom stays
at `hemZ` (hem edge unchanged) but its top always sits above the shoulders.
This only ever *un-clips* wrongly-amputated coverage, so short tops are
byte-identical (nothing exists above the old box top) and the only figures that
change are tall ones with low hems that were already broken.

**The API already promises this** ("coverage is guaranteed by construction …
no bare-skin patches"); the code just wasn't honoring it for tall sleeveless
gowns. So the answer to "do we need a dress generator?" is: the dress generator
exists and is now correct — no new subsystem needed for this class of garment.

**Catalog re-bakes.** Computed the clip condition for every low-hem figure: the
materially-affected entries were runway (21.3u, catastrophic), princess (14.3u,
bare-sternum gap → now closed, genus 6→3), witch (4.6u), and diva (2.2u);
staff_mage and chibi_wizard were never clipped (byte-identical, left alone).
Re-baked the four affected entries against the fixed engine with the committed
palettes; all paint correctly (chest covered, proper gown/robe silhouettes) and
the catalog loader reads the latest (painted) version. Runway now reads as an
elegant column gown with a stride slit instead of a topless cone.

**Regression test.** Exposed `buildTop` via `__figureTestables__` and added two
tests: a floor-length sleeveless gown on a runway-like rig must contain both
bust apexes and the chest-front (the assertion that fails when the bug is
reintroduced — verified), and the hem still cuts the skirt bottom. Typecheck +
1479 unit tests green.
