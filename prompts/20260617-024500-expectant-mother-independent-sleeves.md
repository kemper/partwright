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

The clothes are a good idea but the hands burst out of the clothes and the
limbs/position still don't seem right. Root-cause it: I don't want the arm
clothes merged with the body clothes — make them independent — and something is
still poking out of the dress strangely.

## Assistant

Investigated the colored bake and found two root causes:
- **Blobby merged sleeves.** The dress used `F.clothing.top(sleeve:'short')`,
  whose sleeves are smooth-unioned into the bodice with a large blend radius
  (plus shoulder-yoke spheres). With the arms near the torso this fused the arms
  into a single lumpy mass — not independent garment pieces.
- **Hands poking out.** The bare hands emerged from the sleeves at awkward
  spots; a high-res side crop showed the fingertips poking out from under the
  belly overhang (the "strange poke").

Root-cause redesign:
- Switched the dress to **sleeveless** `F.clothing.top(sleeve:'none')` for the
  body (bodice + belly drape + A-line skirt overlay), so the body garment owns
  no arms.
- Added **independent sleeve tubes** as their own `sleeves` region: per-arm
  shoulder→elbow→wrist capsules with a shoulder-cap sphere to bridge the
  bare-shouldered bodice (no deltoid skin gap). They read as real sleeves, not a
  blob fused to the torso. Palette gives `sleeves` the same colour as `dress` so
  it's one cohesive long-sleeve dress (geometric independence, unified look).
- Re-posed the arms **relaxed at the sides, slightly abducted**
  (`arms: { raiseSide: 10, raiseFwd: 0, bend: 12 }`) so the hands hang at the
  hips (X≈7–8) clear of the belly — no forward thrust, no under-belly poke.
- Triangles: the sleeves pushed it to ~215k, so dropped `handDetail` (hands are
  small at the sides now) and raised `edgeLength` 0.72→0.78 → **162k** tris.

Verified colored hero + side + hand crop: independent sleeves, hands hanging
naturally with visible fingers, clean pregnant silhouette, nothing poking out.
isManifold true, componentCount 1, 162k tris, 10 labels resolve.
