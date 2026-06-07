---
date: 2026-06-05
title: Apply brush wrap tolerance to the non-smooth (projection) brush too
labels: [enhancement]
---

## Human

> When smooth edges is on, this works great, but with smooth edges off, it still
> wraps. The preview indicates that which is nice, but I'd like for the
> non-wrapping to apply to both smooth edges and non smooth edges.

## Assistant

The wrap gate lived only in the smooth/spray path: a smooth stroke stores a
`brushStroke` descriptor and resolves through `buildGeodesicField`, where the
dihedral gate runs. The **non-smooth** brush takes a different path entirely —
`collectBrushFootprint` → `projectBrushFootprint` (a screen-space triangle-ID
readback under the brush disk), committed as a raw `{kind:'triangles'}` set.
That projection is a flat spatial set with no surface gate, so it wrapped over
any edge inside the disk regardless of the tolerance.

**Fix.** Gate the projection footprint with the same dihedral logic, on the base
mesh adjacency that paint mode already builds. Added `gateRegionByBend` to
`adjacency.ts` — the adjacent-pair (accumulating, so curves still flow) BFS of
`findCoplanarRegion`, but confined to a candidate set: it keeps only the
footprint triangles connected to the picked triangle without crossing an edge
sharper than the tolerance. `collectBrushFootprint` runs it per dab (each
pointermove gates from its own pick point, so a drag unions per-sample gated
footprints — mirroring how the geodesic field gates from every sample seed).
180° (cos -1) short-circuits to the un-gated set, so the default-off path is
unchanged. Because the hover preview shares `collectBrushFootprint`, the preview
and the committed paint now agree in both modes.

**Verified.** New unit tests for `gateRegionByBend` (90° fold dropped, gentle
fold kept, no-op at 180°, seed-not-in-set passthrough); the existing
projection-brush e2e still passes; and a real-drag browser check on a refined
cube shows the painted region's z-extent stop at the top face (z=10) at 90° vs
running down the wall (z=8.5) at 180° — screenshots posted in chat.
