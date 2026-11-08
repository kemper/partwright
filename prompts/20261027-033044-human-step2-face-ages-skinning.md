---
session: "01U8g7w9"
timestamp: "2026-10-27T03:30:44Z"
sequence: 3
---

## Human

Going to bed: do all the remaining steps of the realistic-character plan
(kemper/partwright#1151) overnight. Clothing, armor and accessories matter
most. This commit is step 2.

## Assistant

## Key decisions

**Three lazy data packs.** All 238 MakeHuman modelling sliders plus baby/child
bodies would be ~13 MB in one file. They ship as core (always), morphs (when the
source mentions face/torso/morphs/expression/style) and young (when it mentions
age), chosen by a regex on the source, the same pattern as the font preload.
Deltas are i8 unless the step would exceed 0.5 mm at life size. The baby/child
targets visibly crumpled at pure i8, so those use i16.

**Expressions move face bones, not targets.** MakeHuman 1.1 does expressions
through BVH pose units with bone-roll conventions that are risky to reproduce.
The skeleton already has lip-corner, lip, eyelid, brow, cheek and jaw bones, so
channels (smile, frown, browRaise, blink, jawOpen, …) apply small head-frame
offsets and rotations to them. Presets are mixes of those channels.

**Lips, brows and mouth interior are classified in the rest pose.**
- Lips: the lip bones' region, clipped to an ellipse at the mouth corners.
- Mouth interior: flood-filled from the deepest cavity triangle, limited to a
  box behind the lips and in front of the head joint, plus lip-seam triangles
  that straddle the jaw. Getting this right took several probes. The visible gap
  turned out to be the cavity's back wall plus the stretched seam.
- Brows: an arched band sized from the eye spacing. The brow bones' weights gave
  a blob.

**Dual-quaternion skinning by default**, linear kept as an option. The voxel
weld now carries paint labels across by nearest source triangle.
