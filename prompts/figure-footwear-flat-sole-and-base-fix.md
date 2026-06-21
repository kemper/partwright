---
date: "2026-06-12"
task: "fix: real flat boot sole that covers the skin + base contains posed/shod soles"
pr: 634
areas: [figure, sdf, catalog, tests]
---

## Human

The superhero feet still go through the platform, and the bottoms look like skin is showing through a hole in the boots. When I said a flat bottom I want a SOLE — same color as the boot or another color — so it looks like the sole of real shoes/boots.

## Assistant

A probe (`rig.sole.L.groundZ`, base/feet/boot bounds) pinned three root causes:

1. **Base poke-through.** `buildBase` pinned the disc bottom near z=0 and only rose *up* to weld the feet — it never descended to a posed foot. The superhero's left ankle is low (`groundZ ≈ −1.06`), so the boots/feet hung ~1 unit below the disc and pierced it. Fixed by resting the disc bottom on `min(sole.L.groundZ, sole.R.groundZ)` and rising to the weld height; the bulk overlap (feet buried up to the weld top) still guarantees one component. Backward-compatible for standing figures (groundZ ≈ 0).

2. **Skin through the sole.** The instep ellipsoid is the lowest part of the bare foot (`soleCenterZ − 0.65·foot`), *below* the old `groundZ` (`− 0.62·foot`). The flat cut at the old plane left the instep poking through. Fixed by defining `groundZ` at the true underside (`− 0.65·foot`) so the flat clip is at/under the whole foot.

3. **No real sole.** The flat cut just truncated a capsule. Added an explicit **sole slab** — a footprint-shaped `roundedBox` yawed to the foot heading, spanning from the ground plane up into the foot — smooth-unioned into the boot. It reads as a shoe/boot sole, fully covers the skin underside, and carries the boot's label/color (the user was fine with same-color; a contrasting sole would need its own label, a small follow-up).

Verified with the colored catalog bake: dark-red boots with red soles sitting flush on the gray base, no skin tone at the feet, `isManifold: true`, `componentCount: 1`. Added regression tests: boot solid at the foot underside (no bare-skin patch), and base bottom ≤ lowest boot sole (no poke-through). Rebaked `superhero.partwright.json`.
