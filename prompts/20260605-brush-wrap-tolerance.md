---
date: 2026-06-05
title: Brush wrap tolerance — dihedral-angle gate on paint spread
labels: [enhancement]
---

## Human

> I like how painting/stamping with an image doesn't wrap around an edge.
> However, painting with a paint brush does wrap a bit. I am thinking of adding
> a tolerance slider where painting will wrap edges based on tolerance. In my
> mind, wrapping under 90 degree (or not over 270 degrees I think) makes sense.
> Basically, if I'm painting one exterior side of a rectangle I don't expect the
> paint to go to the other side. If I'm painting the inner walls of a hollow cube
> I don't expect paint to wrap to the next interior walls. However, most bumpy
> semi angular triangles I do want to flow over them. Can you implement the
> tolerance slider for me based on that?

Two product decisions were confirmed with the user before implementing:
- **Default value:** on at **90°** out of the box (their stated preference).
- **Scope:** applies to **both** brush surface modes (the default `slab` brush
  and `geodesic`), not geodesic-only.

## Assistant

**Mechanism.** The brush's edge-wrapping is a surface flood-fill across shared
triangle edges (`buildGeodesicField`). The right model for "flow over curves/
bumps but stop at sharp folds" is a *per-edge dihedral gate* — comparing each
adjacent face pair as the fill walks, so angle accumulates smoothly over a curve
but jumps at a crease. (A single seed-normal comparison was rejected: it would
wrongly stop on a gently curving surface.) The gate crosses an edge only when
`dot(nFace, nNeighbourFace) >= cos(toleranceAngle)`. With consistent outward
winding a 90° fold reads as cos 0 whether convex (box exterior) or concave
(hollow-cube interior), so one threshold covers both cases the user described.

**Applying to the default (slab) brush.** Slab is a geometric prism that ignores
connectivity, so the gate is layered on as a reachability mask: when the
tolerance is finite (< 180°) a gated `geoField` is built even in slab mode and
the reachability check in `strokeSignedDist` / `brushClassifier` was decoupled
from `surface === 'geodesic'` to "geoField present". This deliberately also gates
slab's through-wall reach — which is exactly the "don't paint the other side of a
rectangle" behaviour requested.

**Back-compat / perf.** `wrapAngleDeg` is optional on the descriptor; absent ⇒
180° (no gate). The perf-optimised slab default path (sample normals only, no
geoField — see the earlier paint-perf-slab-default work) is preserved *exactly*
for any stroke at 180°, and for every pre-slider saved session. The UI brush
stamps 90°; the `paintStroke` console/AI API defaults to 180° so existing
callers are unchanged.

**Surface.** New `Wrap tolerance` slider in the brush panel (0–180°, default
90°); `get/setBrushWrapAngle` + a `wrapAngleDeg` param on `paintStroke`
(console + AI tool schema); docs in `ai.md` / `colors.md`.

**Verified.** New unit tests for the gate on a 90° folded strip and a gentle
wrinkle (curves still flow); e2e proving a wide stroke on a cube top stays on the
top face at 90° and runs down the walls at 180°, in both surface modes; a
before/after screenshot posted in chat.
