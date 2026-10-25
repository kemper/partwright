---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-23T18:40:16Z"
tools: [subagent, git-worktree, vitest, playwright]
---

## Human

Do all remaining follow-ups of #1049. This part covers the tiny 1–2 px specks near soccer-panel corners in smooth pattern / slab / brush paint.

## Assistant

## Key decisions

**Root cause: T-junctions, not colouring.** On a closed UV sphere a smooth soccer pattern left 8394 edges used by only one triangle. On the in-app `Manifold.sphere(10, 40)` ball it left 6958. Each one is a T-junction, and GPU rasterization shows those as 1–2 px cracks. A centroid-vs-vertex colour check found 0 wrongly coloured triangles, so colour was ruled out. The T-junctions had two sources:
1. The refinement passes split a band triangle's edge on one side only, which was the old deliberate "lean" design.
2. `clipByField` dropped zero-area sub-triangles after a crossing snapped onto a corner. The neighbour across that edge kept the crossing vertex.

**Repair once, after the passes, not per pass.** Closing the band per pass ("green" splits) fed long fan triangles back into the next pass's selection. The many-strokes benchmark went from 88k to 1.2M triangles. Instead, `subdivideSelected` now logs every midpoint, and `closeTJunctions` re-triangulates each neighbour through its hanging vertices in one step:
- hanging points on one edge only: fan from the opposite corner;
- otherwise: fan from a new centroid vertex.

Nothing feeds back into the refinement, so the repair can't cascade.

**Bounded reach for strokes only.** Brush strokes and image stamps are appended one by one. Re-fanning a huge CAD face would make every later stroke on that face refine hundreds of slivers. So those regions only repair neighbours within 16× `maxEdge` (`tjReach`). Patterns, slabs, boxes and cylinders are one region each and repair everything. Triangles outside a region's `allow` scope are never touched, which keeps the "a ball pattern never splits the hand" guarantee.

**Clip without losing crossings.** Clipped pieces are now emitted as polygons (`emitPoly`), fanned from a corner that gives no zero-area triangle, instead of dropping degenerate sub-triangles. A crossing also snaps onto an endpoint that lies within 1% of `maxEdge` of the contour. That decision is per vertex, so neighbours agree, and it avoids hair-thin slivers where a contour runs beside a line of vertices.

**Result.** 0 open edges in both cases. The in-app ball goes from 9.9k to 13.9k triangles. The browser perf spec ("many strokes stay fast") still passes.
