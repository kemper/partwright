---
date: 2026-06-21
author: claude (opus-4-8)
task: Figure accessory/attachment system — Phase 0 frames+verbs + one-item-per-mode taxonomy validation (PR #830, tracking #828)
---

## Liked
- The rig ALREADY had the right shape (grip/sole/face/torso frames + holdAt/placeOnHead/standOn). Reading the existing frame style first meant the new frames (ring/shoulder/back/forearm) and verbs (ring/ringPoint/strap/hangFrom/onFace) dropped in as exact mirrors — no new patterns, all spine-transformed for free via the existing sPt/sDir.
- Parallelizing the 6 remaining items across `model-sculpt` subagents while I built the foundation + unit tests. Each owned its render→iterate loop in its own context and returned text + a PNG path; I reviewed only the final previews. Kept image tokens out of the main context and ran ~5 items concurrently.
- A unit test caught my own off-by-tube assumption on the band radius (centre-line at rx+clearance+tube → outer edge +2·tube) before it ever rendered.

## Lacked
- A general per-region fine-march for THIN accessory features. Glasses temples / chains / straps fragment on the coarse march, and the `detail` REFINE pass FRAYS them (the same failure as over-refined fingers). `__fineHands` is the right mechanism but it's hands-specific and @internal. I burned ~5 iterations on the glasses temples before settling on the workaround (hug the surface + print-chunky + finer global edge). This is now filed as a Phase-0 stretch follow-up, but a `F.fineRegion(node, edgeLength)` would have saved the whole detour.
- `model:preview` azimuth is NOT what `--views front` gives: `--view 0,el` renders a SIDE profile, not the front. I wasted two renders on profiles before switching to named views. Worth a one-line note in the model:preview docs ("az 0 ≠ front; use --views front").

## Learned
- A thin accessory with its OWN `.label()` meshes in its own partition region, but that region's bbox includes the whole accessory — so `build`'s direct-fine-march only triggers if the WHOLE accessory bbox is tiny. Long thin arms keep the region big → only the refine path applies → fraying. Label isolation helps paint, not thin-feature topology.
- SDF `.taper` is NEGATIVE to narrow toward +Z; positive flares OUT (a hat crown became a funnel until I flipped the sign). The figure.md hat example already uses `-0.9` — should have trusted it.
- `api.paint.*` only exposes box/slab/cylinder/label (no sphere); a round cheek blush comes from a small, square, SHALLOW box on the cheek apple — a wide/deep box wraps the curve into a streak reaching the ear.
- SDF-inflating an organic torso (`.round`) reads as a fat torso, not plate armor. Hard `.intersect` (crisp collar/fauld edges) + a centre keel ridge + a fauld band + layered pauldron lames is what makes it read as a cuirass — soft smoothUnion everywhere is what made it look padded.

## Longed for
- `F.fineRegion(node, { edgeLength })` — a public, general version of `__fineHands` so any thin accessory (or small feature) gets a true per-region fine march + hard-union, instead of every author rediscovering the chunky-or-fray workaround.
- A colored preview in the fast loop. `model:preview` shades by normal, so `.label`-colored accessories (belt/hat/armor) can't be color-checked headlessly — only in-code `api.paint.*` shows. A `--palette` flag on model:preview (apply byLabel colors) would let me verify layering/color separation without the slow dev-server bake.
