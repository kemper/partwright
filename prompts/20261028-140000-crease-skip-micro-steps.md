---
session: "01CXxFpQDo4c2MfrSHT7paFF"
timestamp: "2026-10-28T14:00:00Z"
sequence: 6
---

## Human

Asked whether the two follow-ups left after #1093 were still needed, and if
so to open PRs for them. This one is #1112: a scoped `api.round` /
`api.smoothWeld` leaves a tiny step where its remeshed strip meets the
untouched model, and the crease-edge overlay in `renderView` outlines that
step, so a clean edit looks like a defect.

## Assistant

## Key decisions

**Fix it in the edge overlay, not the op.** The issue's other ideas were to
stitch or snap the remesh onto the input. Snapping the boundary ring was
tried first: it folded triangles 180°, and `simplify` didn't clear the folds.
Shaded, the step is invisible. Only the crease lines show it, so the overlay
now leaves out micro-steps. (This is the issue's third listed option.)

**What counts as a micro-step.** A crease is dropped only if all three hold:
- Its wall is thin: each wall triangle spans less than `minStep` along the
  face's normal, so the wall is as short as the step.
- On the far side of the wall is a face roughly parallel to the near one
  (within 35°).
- That face sits on the opposite side of the wall's plane.

The opposite-side rule matters. Without it, two facets of a curved pocket
wall beside a sliver floor triangle looked like a step, and an engraved
plate lost its cylinder rims. There is a unit test for that case.

**No plane-offset test.** The remeshed faces lean a few degrees, so the
offset between the two levels' centroids came out larger than the real step
and the seam survived. The wall's own span is the step height, which is why
the thin-wall rule is enough on its own.

**Same edges as before when it doesn't apply.** At `minStep` 0 the new
extractor matches `THREE.EdgesGeometry` segment for segment (checked on the
scoped round and an engraved plate). The engraved plate's edges are
identical with the filter on. It runs about as fast as `EdgesGeometry`.

**Tunable.** The threshold is `renderer.creaseMinStep` (0.004 × the model's
bounding-box diagonal by default) in Advanced Settings, and 0 turns the
filter off.
