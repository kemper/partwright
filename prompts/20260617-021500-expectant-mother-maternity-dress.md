---
date: 2026-06-17
branch: claude/wonderful-planck-02rnpz
files_changed:
  - examples/figure_expectant_mother.js
  - public/catalog/expectant_mother.partwright.json
  - public/catalog/manifest.json
  - public/catalog/palettes/expectant_mother.json
---

## Human

After the first belly-bump fix, the figure still looked bad — "almost naked
with a cone coming out of her crotch," inappropriate. Fix it properly before
release.

## Assistant

Re-probed the geometry and confirmed the user's read exactly:
- The "cropped top" was a high bandeau (hem Z41, just under the bust) and the
  skirt sat at the hips (waist Z25.7), leaving **15.5 units of bare torso** —
  the whole abdomen bare ("almost naked").
- The first fix had lowered the bump too far: its bottom (Z24.5) sat *below*
  the hip joint (26.1) and below the skirt waistband, so the forward swell
  emerged at crotch level and the narrow cone skirt flared beneath it ("cone
  from the crotch").

Also learned `F.clothing.top` shells the **rig torso**, not a custom welded
bump — so no standard top drapes over the belly.

Redesign — a fully-clothed **short-sleeve maternity sundress**:
- Dropped the bare bump + navel from `skin` (body stays plain underneath).
- Raised the belly ellipsoid to the abdomen (centre just above the navel, bulk
  above the pelvis, bottom ≈ Z28 — above the hips).
- Built the dress as `F.clothing.top({ sleeve:'short', hemZ: height*0.18 })`
  (a low hem auto-becomes a dress: shoulders + sleeves + flared skirt + a
  guaranteed-coverage underlayer), then smooth-unioned a **belly drape** (the
  bump grown by the garment thickness) so the dress bulges over the abdomen,
  and an **A-line skirt overlay** wider than the hips.
- The skirt overlay fixed a colour-bleed defect found in the colour bake: where
  the auto-skirt narrowed at the hip the body sat at the dress surface, flipping
  those triangles to the skin colour (a tan patch on the dress). Standing the
  skirt off the legs removed it — verified with a high-res cropped colour bake.
- Updated the palette (top/skirt → a single `dress`) and the catalog manifest
  description.

Result: isManifold true, componentCount 1, 197k tris (under budget), 9 labels
resolve. Verified colour hero + side + high-res hip crop — fully clothed,
clearly pregnant, no bare midriff, no crotch cone, no colour bleed.
