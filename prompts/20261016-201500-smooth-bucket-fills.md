---
session: "charming-bohr-9tr80j"
timestamp: "2026-10-16T20:15:00Z"
sequence: 3
tools: [playwright, vitest]
---

## Human

(Continuation of the paint-tooling session.) The agent asked twice for a
`smooth` option on the bucket tools — "clip triangles along a smoothed contour,
the way paintStroke does" — plus boundary-only refinement so a hem / sock roll /
hairline on a scan mesh isn't a triangle sawtooth. Third stacked PR, with
visual and behavioral proof.

## Assistant

## Key decisions

**Blurred coverage field, clipped by the existing pipeline.** Rather than
fitting and smoothing a boundary polyline (hard to keep inside/outside robust on
arbitrary meshes), the fill becomes a per-vertex coverage value (fraction of
incident area inside the fill), blurred a few passes only in a band around the
edge, and the 0.5 contour is handed to `RefineRegion.field`. `clipByField`
already cuts boundary triangles exactly along a field, so no new mesh surgery
was needed. The field is linear inside each base triangle, so there's no
subdivision at all — only boundary triangles get split (the mesh grows ~1–2%).
Trade-off: on a very coarse mesh the edge is a gentle polyline, not a curve;
on scan-density meshes that reads as a clean line, which is the use case.

**Replayable like the other smooth tools.** `smooth`/`smoothness` are optional
fields on the existing `coplanar` / `connectedFromSeed` descriptors (no new
kind, no schema bump — same precedent as slab `smooth` and the clamp fields;
older builds just render the raw fill). The field is rebuilt deterministically
from descriptor + pristine base mesh, so the subdivision worker, a reload and a
model re-run all cut the identical edge — pinned by unit (worker pipeline) and
e2e (live == re-run == reload) tests.

**Crease pinning.** First version erased a cube's top face: with no interior
vertices every corner had partial coverage. Fix: where the fill's edge already
follows a fold sharper than 45°, those vertices are pinned on the 0.5 contour
and never blurred, with exact ties broken by the raw fill. CAD faces keep their
crisp outline; only jagged edges get smoothed. A vertex where a jagged edge
meets a crease stays free — pinning it dragged a one-triangle notch along the
crease (caught by a unit test). The crease angle is a fixed constant rather
than an appConfig knob on purpose: the worker can't see user overrides, and
every thread/reload must cut the same edge.

**Performance.** First cut took 6.4 s at 95k triangles. Profiling showed the
per-triangle resolve dominated: `triGridFor` sizes cells to the volume, so on a
surface each lookup tested ~800 triangles. A surface-sized grid plus a topology
shortcut (only triangles near the band need a lookup; each connected patch
elsewhere is uniformly in or out, so one lookup decides it — verified equal to
the brute-force result) and reusing the caller's adjacency brought it to ~1.5×
a raw fill (≈3 s vs 2 s at 300k triangles).

**Folded-in fix.** `refinePipeline.collectRefineRegions` (the worker copy)
dropped the cylinder `axis`, so worker rebuilds refined smooth x/y-axis
cylinders along z. main.ts now uses the shared `descriptorRefines` /
`collectRefineRegions` instead of its own duplicates, which removes the drift.

**Scope kept out:** the interactive bucket tool in the paint panel doesn't get
a smooth toggle in this PR (API/AI only, as the agent asked) — tracked as a
follow-up. Colour-mode bucket (`colorFlood`) isn't smoothable yet either.
