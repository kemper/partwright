# Retro — belt-on-arm shipped twice behind a clean front view

## Liked
- The `F.sharedSolid` invariant primitive I'd just built actually pinpointed the
  bug numerically (sweep of `occludeArms` → exact value that zeroes sleeve
  overlap). Once I trusted it, the fix was deterministic, not guess-and-render.

## Lacked
- A mandatory **multi-angle (incl. side) render** before declaring an accessory
  "off the arm". I verified from the front/iso, which is exactly where a belt
  crossing the sleeves hides. The user caught it by rotating the model — twice.
- A hard rule that **any nonzero `sharedSolid` overlap is a FAIL**. I saw the
  10.6 u³ residual in my own validation and rationalized it as "minor", then
  shipped. Quantified-but-ignored is worse than not measured.

## Learned
- `occludeArms` (and any limb-occlusion allowance) must dilate the limb **past the
  worn layer's OUTER surface** = clothing thickness + that layer's own clearance +
  thickness. Sizing it to the garment thickness alone carves the inner part and
  leaves the outer shell on the sleeve.
- The invariant check must target the **sleeve** (`F.arms(rig).round(clothThick)`),
  NOT the bare arm — the bare arm sits inside the sleeve, so it always reads clear
  even when the belt is plainly on the sleeve. My first probe checked the bare arm
  and reported 0, masking the bug.
- Conform a belt to the garment it sits over, sized by **bagginess**: fitted shirt
  → torso core; loose coat → the clothed surface (or it disappears under the robe).

## Longed for
- A render harness default that always emits a side + 3/4 + underside tile for
  figures, so "looks clean" can't come from a single lucky angle.
- The invariant gate wired to RUN on the catalog bake (fail the bake on
  sleeve-overlap / componentCount != expected), not just an opt-in author call —
  tracked as the pillar-2 in-build gate in #853.
