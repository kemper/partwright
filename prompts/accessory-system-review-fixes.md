---
date: 2026-06-21
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/sdfFigure.test.ts
  - tests/unit/figureAttachment.test.ts
  - examples/figure_knight.js
  - examples/figure_scholar.js
  - examples/figure_noble_lady.js
  - public/ai/figure.md
---

## Human

Review feedback on the showcase figures: knight's sword welds to the wrong
(back) side of the hand — ensure this CLASS of mistake can't recur; scabbard
passes through the leg; scholar belt has floating (unprintable) sections; hat is
too high (a recurring bug); noble lady necklace embeds the dress; makeup is bad
(avoid mesh painting); knight's clothes poke through the armor (armor should
layer like clothing on skin); knight's sword looks like a club, not a blade.
Also implement the strap.

## Assistant

Most were **API-level bugs** in the attachment layer — fixed at the source so all
figures benefit and the class can't recur:

- **Grip palm side** — the grip frame computed `palmNormal = cross(hinge,
  foreDir)`, the NEGATIVE of the hand builder's actual palm (`placedHand` maps
  canonical palm +Y → `cross(dir, splay) = cross(foreDir, hinge)`). So held props
  seated on the BACK of the hand. Flipped the sign + added a unit test that locks
  `grip.palmNormal` to `cross(foreDir, hinge)` and the grip point to the palm side.
- **Hat too high** — `placeOnHead` rested the brim on the hair TOP. New default
  (no `rest`) seats it on the head at `head.z + r.headZ·sit` (sit 0.35 ≈ brow);
  legacy `rest` behavior kept for callers tuned to it. Test updated.
- **Conformance (`F.ring`/`F.ringPoint`/`F.strap`)** — added a `surface` opt: a
  shared `marchToSurface` ray-marches the real (clothed) body and the band/anchor
  sits flush ON it. Fixes the floating belt (unprintable), the necklace embedding
  the dress, and is the Slung-strap surface-routing (project each sample forward
  onto the chest, so a sash lies on the body instead of burying/bowing through).

Figure fixes (re-baked Knight/Scholar/Noble Lady):

- **Armor layering** — build the cuirass by offsetting the SHIRT surface
  (`shirt.round(gap)`), the way clothing offsets skin, so the shirt can never poke
  through.
- **Sword blade** — was a club: a centred tapered box flares at the base (`taper`
  is anchored at z=0). Rebuilt as a constant-thickness slab ∩ a width-tapering
  wedge (wedge Y huge so thickness never thins) → a flat blade tapering to a
  printable point, no two-axis pinch (the over-tapered tip shed a floating sliver).
- **Scabbard** — anchored on the conformed clothed surface and pushed further out
  so it hangs beside, not through, the leg.
- **Makeup, paint-free** — dropped `api.paint.box` (rectangular, rig-dependent).
  Lipstick = the existing `lips` label; eyeshadow = the `lids` label; blush = a
  thin CONFORMAL patch (`skin.round(proud)` ∩ a cheek cylinder) owning its own
  triangles — all coloured by `.label`, rig-independent and printable.

Docs updated in `public/ai/figure.md` (surface conformance, the new `placeOnHead`
seat). Tracking: #840.
