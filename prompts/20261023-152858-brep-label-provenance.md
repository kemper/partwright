---
session: "017xgfPQK41H8feC99NhRjKm"
timestamp: "2026-10-23T15:28:58Z"
tools: [playwright]
---

## Human

"merge it when green, then fix #1061" — BREP labels map to the wrong
triangles (found while building the object list's part delete).

## Assistant

## Key decisions

**Two causes, both fixed.**

1. **Triangle order.** In replicad sessions the label map indexed the BREP
   tessellation, but the engine returned `Manifold.ofMesh(...).getMesh()`,
   which canonicalizes (reorders) triangles. The code comment claiming order
   was preserved was wrong. The same was true, and worse, for
   `BREP.toManifold` inside JS sessions, whose labels were queued as raw
   triangle ids and broke on any later boolean. Fix: a new
   `ofMeshWithLabels` (brepRuntime) gives each label's triangles its own run
   with a `Manifold.reserveIDs` id before `ofMesh`. The replicad engine
   resolves labels from the canonical mesh's `runOriginalID`, and
   `toManifold` queues the id → name registry, which manifold-js merges into
   its own labelRegistry. That's the provenance mechanism `api.label` and
   `api.importWithParts` already use, so labels now survive canonicalization
   and booleans. `mergeLabelMaps` became dead and was removed; manifold-js's
   `resolveLabelMap` is exported and replaces OpenSCAD's duplicate copy.

2. **Spatial fallback on rebuilt faces.** A face OCCT rebuilt without history
   was labelled from its single centroid. For the box top left as an annulus
   by a fused peg, that centroid sits in the hole, inside the peg's bbox, so
   the smallest-bbox tiebreak gave the whole top to the peg (`base` = 10
   tris). Pass 1 is now an area-weighted vote: each triangle's centroid goes
   to the smallest containing bbox, and the face takes the label with the
   most area. That also helps the documented nested-feature (eye-in-head)
   case.

**Catalog check.** Twenty catalog entries use BREP labels. A shared engine
fix doesn't re-bake thumbnails, so I rendered lighthouse_brep, coffee_mug and
butt_hinge with the fix against their baked thumbnails. All match visually,
so no re-bake is needed.

**Docs:** the replicad.md gotcha that described "labels get SCRAMBLED" (the
symptom of cause 1) is rewritten to what's still true after the fix.
