---
session: "irolyph"
timestamp: "2026-06-06T12:30:00Z"
model: claude-opus-4-8
sequence: 3
tools: [model:preview, single-catalog-entry.cjs]
---

## Human

The sliced-ribbon spiral cones are "fundamentally a variation on the original."
The real fidget (from a video, with screenshots) is a two-part NUT-AND-BOLT: a
5-start male screw inside a distinct female socket, beveled/rounded threads,
clearance, a 5-lobe base. Build a new catalog model for this; keep an eye on
generalizing it to any shape ("loose bolt and nut" applied to cubes/cylinders).
Decisions: build the catalog model first (screwSplit helper in its code), hold
PR #461 as a draft, hidden-screw look (smooth threaded cone hiding the screw,
surprise on unscrew), 5 starts, pointed tip.

## Assistant

## Key decisions

**Construction.** Distinct male/female parts, not a sliced solid. Build the male
screw (an N-lobe profile twist-extruded → N-start helical thread), then DERIVE
the socket bore from it and subtract from the outer cone. Wrapped as a reusable
`screwSplit({threadProfile, outline, ...}) -> {screw, socket}` helper.

**Two non-obvious traps found via model:preview (the whole reason this took
iteration), both now baked into the helper + a mechanisms.md-worthy note:**
1. Two *independently faceted* lobed surfaces (screw vs a re-derived offset bore)
   tangent-touch and fuse at ANY clearance — `componentCount` stays 1 even at a
   2 mm gap, because the contact is a zero-volume edge between facets. Fix:
   derive the bore by scaling the SCREW'S OWN mesh outward (`cut =
   screw.scale([s,s,1])`) so the gap is the same facets pushed out — collision-
   free by construction. `s = 1 + clearance/peakR`.
2. The screw and socket sharing the z=0 build plane (and z=H top) weld along the
   coincident face edge → comp 1. Fix: widen the socket's base mouth over the
   bottom ~1.6 mm and recess the screw top below the bore, so no coincident
   faces remain. Verified comp 2 + a cutaway showing engaged threads with a gap.

Also: a tapered/pointed cone pinches the proportional mesh-scale gap toward the
tip, so thread only the lower 62% (where the taper keeps the gap ≥ ~0.4 mm) and
let the smooth outline continue to a point as one piece (no cap seam).

**Catalog.** Added `spiral-screw-cone` ("Hidden-Screw Spiral Cone") to the
fidget-toys group with a real baked thumbnail (ALLOW_MULTI_COMPONENT=1) and a
[PRINT] note. Seven parameters (starts/baseR/height/turns/clearance/threadDepth/
bore); verified comp 2 across starts 3-7 and param extremes. Updated the
catalog.spec.ts assertion from 4 → 5 fidgets. PR #461 left as a draft; this rides
the same branch additively (disposition is the user's call).
