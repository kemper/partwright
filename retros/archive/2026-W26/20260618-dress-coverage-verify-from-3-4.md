# Retro — figure dress coverage bugs (PRs #742, #744)

**Liked.** The headless SDF-probe loop (`model:preview` + `throw new Error(JSON…)`)
nailed both root causes deterministically — marching `evaluate()` along an axis to
find where skin beats dress beat any amount of eyeballing. Pixel-classifying the
colored bake (skin vs dress by channel order) settled "is that patch actually skin"
objectively when my eyes said one thing and the geometry said another.

**Lacked.** A straight-front colored bake hid the outer-thigh skin patch entirely
(it faces sideways), so my first investigation pass came up empty and I nearly told
the user it was just shading. Garment coverage defects don't live on the front.

**Learned.** `F.clothing.top`'s dress branch had TWO independent coverage holes that
both read as "skin patch on the dress": the hem-clip box amputated the chest (#742),
and the centered cone skirt has no leg coverage so spread legs poke out the side
(#744). The coverage underlayer is `buildTorso` (no arms unless sleeved, no legs
ever) — any body mass not in that set can poke through a thin shell.

**Longed for.** A standing "garment coverage" check: bake every clothed figure from
≥3 angles (incl. one 3/4) and flag skin-labeled triangles that sit on the outer
garment surface within the garment's z-range. Both bugs would have been caught
automatically at bake time instead of by a user noticing a patch. Verifying garments
ONLY from the front is how both shipped.
