---
session: "fe6e04b5"
timestamp: "2026-10-28T02:20:00Z"
sequence: 2
---

## Human

"I don't know that I see PR 1173 being better. Can you attach a better visual
proof? I still see a blue line on the red (and I think maybe I see more blue
spots?). The outer edges seem to line up better interestingly ... Can you
double check add more visual proof? After that, resume the original painting
task. I'm about to go to bed and want to wake up to it being fully done. Make
whatever you think is the most typical paint mode the default."

(The original painting task: the brush always sits perpendicular to the
triangle under the cursor, which makes painting complex models hard; asked for
a mode where the brush stays perpendicular to the view ray and paints whatever
is under it, and possibly a sphere brush. Proposed and filed as #1174: View /
Smoothed alignment, Front faces only, Sphere, camera-facing ring.)

## Assistant

## Key decisions

**Proof re-shot as a true A/B.** The first before/after came from two runs with
different framing on a model whose huge fan triangles painted far outside the
brush, so the leftover strip line was outside the brush, not a failure. The new
proof runs both passes in one session with the same top-down camera and stroke,
toggling only `ui.paintBrushSliverPx` (0 = main's behaviour), on a finely
gridded slab. At normal zoom a sub-pixel seam is invisible in both, so the
decisive image is a close-up drawn from the exact painted triangle sets: 18/18
seam slivers under the stroke unpainted before, 0/18 after.

**Alignment is per stroke and persisted.** `brushStroke` descriptors gain
optional `align` ('surface' | 'area' | 'view'), `view` ({dir, origin} captured
from the camera at stroke start) and `frontFaceMaxDeg`; `surface` gains
'sphere'. Everything is optional and absent fields resolve byte-identically,
so old sessions are unchanged (no REFINE_ALGO_VERSION or schema bump). View
alignment reuses the slab prism (per-sample normals = camera rays, fanned from
the camera position for perspective). Front faces only is a per-triangle filter
at footprint resolution, since the clip field is per-point and can't see facing.
'area' averages same-side triangle normals within the radius.

**Defaults.** The UI brush now defaults to View + Front faces only (the
"projected" brush of Blender texture paint / ZBrush, and what the user
found "close" with the projection brush at 180° wrap). View mode ignores the
wrap tolerance (the slider hides): front faces and depth bound it instead;
auto depth is the full radius along the ray so a 45°-tilted surface keeps the
whole circle. The console/AI `paintStroke` keeps its old defaults ('surface',
no facing filter) so existing agent scripts behave the same.

**DRY.** main.ts's `descriptorToStroke` duplicated refinePipeline's
`buildBrushStrokeFromDescriptor`; it now calls it, so the new options live in
one place for the main thread and the worker.

**Not done:** a CPU occlusion test for the smooth brush (paint behind visible
geometry within `depth` along the ray is still possible; front faces + depth
cover the common cases).
