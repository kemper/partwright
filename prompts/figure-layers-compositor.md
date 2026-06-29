---
date: 2026-06-23
branch: claude/admiring-goodall-1tlwna
files_changed:
  - src/geometry/sdfFigure.ts
  - tests/unit/figureAttachment.test.ts
  - public/ai/figure.md
  - examples/figure_knight.js
---

## Human

(Continuing the figure-modeling architecture, tracking #853.) Still seeing armor
bleed onto the arm — "if the arm gets close to his body the armor bleeds onto the
arm so one sleeve is brown and the other is armor." Build the priority-layering
primitive (chosen pillar 1) and fold the figures into it.

## Assistant

Built **`F.layers(rig, entries)`** — the priority compositor that makes the
clothing/armor stack a declared z-order (pillar 1).

The pipeline map showed the "bleed" is NOT a paint bug — SDF `.label()` is exact
(runOriginalID provenance). It's **geometric overextension**: the cuirass
(`shirt.round(gap)∩zone`) physically bulges onto the arm, so exact labeling then
correctly paints those covered triangles as armor. Fix = carve the limb out of the
plate.

`F.layers` semantics: each entry `{node,label?,priority?,carve?,occludeArms?,occlude?}`.
Higher priority wins contested space; `occludeArms:<allowance>` carves the
sleeve-dilated arms from a torso layer; `carve:false` protects the base body +
props (and the fine-hands marker, which can't survive being buried in a subtract).
The no-hole guarantee: lower layers are carved by each higher layer's
ALREADY-occluded solid, so trimming a plate off a limb can't punch a hole where
the limb shows. Unit-tested (no-hole, carve:false intact, occludeArms).

Two performance/quality lessons learned the hard way (both fixed):
- **Occluder must be cheap + Lipschitz.** First version subtracted
  `buildArms().round(grow)` — a deep, non-Lipschitz tree — which made the knight
  time out (>5min) AND left coincident-surface slivers + split it into 2
  components. Replaced with a 6-capsule arm chain (upper/fore/hand, dilated):
  clean cuts, componentCount back to 1, 1m31s.
- **Don't priority-carve heavy undergarments needlessly.** The O(n²) carve of
  shirt/pants by every higher layer compounded partition eval cost. The cuirass
  already offsets outward from the shirt, so shirt/pants are `carve:false`; only
  the belt + cuirass pay (for arm-occlusion). Pauldrons are a separate
  non-occluded layer so the limb-occlusion doesn't eat the shoulder caps.

Knight refactored onto F.layers and verified: cuirass clean on the torso, arms
show shirt sleeves (no steel bleed), pauldrons on the shoulders, flush belt,
thumb-inward grip, manifold/1 component. Scholar + noble lady fold in next; bakes
follow once all three are on the new system.
