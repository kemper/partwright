---
date: 2026-06-25
branch: claude/admiring-goodall-1tlwna
files_changed:
  - examples/figure_noble_lady.js
  - public/catalog/noble_lady.partwright.json
---

## Human

"the belt looks great. I don't see any downside to this approach. do you? can
you make the noble lady necklace bigger and maybe have gemstones?"

(Follows the garment-parts root-cause fix for belt/armor-on-the-arms, already on
this branch. The noble lady's necklace was a thin gold chain with one tiny gem.)

## Assistant

Upgraded the noble lady's necklace into a proper jeweled piece, keeping the
parts-based collar fix (the collar conforms to `F.neck(rig)` — the bare neck
column — so it hugs the neck and can't spread onto the shoulders/gown):

- A **row of emerald cabochons** set around the front of the gold collar, each
  seated just proud of the chain by pushing it out along the ring-plane radial
  (`radialDir(az)` from the neck frame's x/y axes), centre stone larger.
- **Two emerald accents** on the gold chain drop.
- A **large faceted teardrop sapphire pendant**: a domed ellipsoid crown
  smooth-unioned with a cone pavilion that tapers to a point below, so it reads
  as a CUT stone, not a smooth pearl. The cone is the taper-anchored-at-z=0
  trick — `cylinder(r,L).translate([0,0,-L/2]).taper(1/L)` gives full width at the
  top and a point at z=−L (verified by render after a first attempt collapsed the
  gem to 129 triangles; sizing it to `r.neck*0.52` gave a 3146-tri statement stone).

New paint labels `gem` (emerald `#1f8a5a`) and `gemCenter` (sapphire `#2456c8`)
alongside the gold `jewelry`. Verified front + 3/4 at high res: the collar hugs
the neck, the pendant stands proud of the chest (not sunk/piercing the bust),
manifold, 1 component. Re-baked the catalog entry.

On the user's "any downside?" — answered honestly in chat: the parts approach is
additive (two ways to get a garment, the single-registry unification in #853 is
still the end state), `clear: F.arms(rig)` subtracts the full anatomical arm SDF
(a guarantee you pay mesh time for), the torso panel mirrors the garment shell
math, and only top/pants have parted forms so far. None change the recommendation.
