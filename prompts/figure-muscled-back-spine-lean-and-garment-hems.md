---
date: 2026-06-16
task: Fix figure-API geometry defects — muscled back twin-lobe under spine lean (#702) and jagged garment hems (#704)
files:
  - src/geometry/sdfFigure.ts
---

## Human

Fix two figure-API geometry defects in `src/geometry/sdfFigure.ts`, editing only the
muscle back-mass code and the garment seam/hem code:

- **#702 (priority):** on a muscled, spine-leaned figure (`figure_sprinter_start`,
  `muscle 0.6` + forward lean) the muscled upper back deforms into a twin-lobed bulge
  with a central depression and a knob behind the upper back. An upright muscled figure
  (`figure_weightlifter`) has a clean back, so the masses are failing to track the leaned
  spine. Invariant: `muscle: 0` figures stay byte-identical; upright muscled figures stay
  clean; a non-muscled figure stays unchanged.
- **#704 (garment part):** garment booleans alias into a sawtooth seam where they meet the
  body (boxer waistband, baby diaper hem, weightlifter shorts hem). Soften the edge with a
  small round / thin hem detail; keep coverage and paint labels.

## Assistant

**#702 — root cause.** `buildRig` applies the spine rotation (`sPt`) to the chest and
upper-arm joints, but the abdominal/lat anchors hang off the planted navel line
(`j.spine`/`j.hips`, never leaned). The muscle masses in `buildTorso` mixed leaned
chest/arm coordinates with un-leaned navel coordinates, so under a forward lean half of
each mass welded to the leaned chest and half to the upright pelvis — tearing the upper
back into the twin-lobed bulge. Fix: build every muscle mass in the figure's REST frame
(un-rotate the chest/upper-arm anchors back about the navel pivot with the inverse of the
rig's `spineRot`), then rigidly re-apply the same spine rotation to each assembled mass via
chained single-axis `.rotate` calls (Z→X→Y composes to the rig's `Ry·Rx·Rz`). When the
spine is zero, the un-rotation and the re-rotation are both identities and every formula is
unchanged, so `muscle: 0` and upright muscled figures (`figure_weightlifter`) stay
byte-identical — verified: weightlifter volume/triangleCount/surfaceArea identical to HEAD
with Fix A alone. Kept the four original per-mass `smoothUnion` blend radii so the upright
weld is preserved exactly.

**#704 — root cause.** The garment coverage underlayer is `body.intersect(<flat box>)`; a
hard intersection of the curved body SDF with a flat plane at the waist/hem aliases the
crease into a sawtooth at the mesher's resolution. Fix: replace the hard cut with a small
`smoothIntersect` (k = garment thickness) against a half-space at the waist/hem line, and
extend the zone box a hair past that line so only the soft cut owns the visible edge. The
round only rolls the very edge inward by ≤ k, well inside the garment, so it can't open a
bare-skin gap, and the paint label rides the whole coverage node untouched. Applied in both
`buildPants` (waistband top) and `buildTop` (shirt hem bottom).

**Verification.** `model:preview` from side + rear: sprinter back now reads as a smooth
muscled back (twin-lobe + knob gone); weightlifter back stays clean; boxer/athlete hems
soften from a jagged crease to a rolled band edge; all figures stay `componentCount: 1`,
`isManifold: true`. typecheck + 1433 unit tests green.

**Scope note.** A concurrent agent's in-progress nose-realism (#703) edits to
`buildNose`/`faceDetail` were present (unstaged) in the shared worktree. Those are out of my
scope and another agent's work, so this commit stages ONLY my six hunks (the muscle block in
`buildTorso` and the two clothing builders) and leaves the nose changes in the working tree.
