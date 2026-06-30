---
date: 2026-06-23
branch: claude/admiring-goodall-1tlwna
files_changed:
  - examples/figure_scholar.js
  - examples/figure_knight.js
  - public/ai/figure.md
  - public/catalog/scholar.partwright.json
  - public/catalog/knight.partwright.json
---

## Human

"I'm not convinced this nailed it. I checked out one of the catalog entries,
scholar, and his belt still goes on his arms."

## Assistant

The user was right — and my own `sharedSolid` validation had flagged the residual
(10.6 u³) which I waved off as "minor". Two compounding bugs in how I'd set up
`occludeArms`:

1. **occludeArms was sized to the GARMENT thickness, not past the belt's OUTER
   surface.** A belt conformed to the clothed body sits `clearance + thickness`
   *outside* the sleeve; the arm occluder (dilated by only the clothing thickness)
   reached the sleeve's inner face and carved the belt's inner part, **leaving its
   outer shell on the sleeve**. From the front it's hidden; from the side the brown
   belt visibly crosses the arms. Swept occludeArms with `sharedSolid` (checking
   against the SLEEVE — `F.arms(rig).round(coatThick)` — not the bare arm, which is
   inside the sleeve and always reads clear): the overlap only zeroes at
   `coatThick + beltThickness`. Bumped occludeArms to reach past the belt
   (clothing + clearance + thickness + margin) on the scholar belt, knight belt,
   and knight cuirass.
2. **My first fix over-corrected** — conforming the belt to the tight torso core
   made it disappear *under* the baggy coat (visible only as side wedges). So:
   conform a belt to the garment it sits over, sized by bagginess — a *fitted*
   shirt → torso core; a *loose* coat → the clothed surface (visible on the robe)
   and rely on the large occludeArms to strip the sleeve. Knight (fitted shirt) =
   torso core; scholar (loose coat) = clothed surface + large occludeArms.

Verified from the SIDE angles that previously hid it: scholar belt now visibly
cinches the coat AND terminates at the arm; knight clean. Corrected the
`occludeArms` sizing rule in figure.md (+ the gotcha that the invariant check must
be against the sleeve, not the bare arm). Re-baked both.

Lesson: a multi-angle / side render is mandatory for "is it on the arm" — the
head-on view hid it, and I shipped twice on a clean-looking front. The
`sharedSolid` gate caught the residual numerically the whole time; I should have
treated >0 as a failure, not "minor".
