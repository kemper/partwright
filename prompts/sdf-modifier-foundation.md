---
date: 2026-06-09
author: claude (opus-4-8)
area: surface modifiers / shared SDF scaffolding
---

## Human

After the Voronoi-lamp smooth-walls work merged, the user wants to add a family
of related "volumetric" operations (hollow/vase, gyroid/honeycomb infill,
conformal lattice/perforation, wireframe cage, engrave-through) and intends to
implement them in parallel across separate sessions. They asked me to **first
land a PR that extracts the shared code** so the parallel feature work is mostly
additive and doesn't collide, then hand them prompts.

## Assistant

Extracted the reusable core of the SDF mesh path into `src/surface/sdfModifier.ts`
— `sdfModifierMesh(mesh, { resolution, bandWorld, watertight, smoothIterations },
combine)`. It owns everything generic and finicky:

- rasterize for a robust inside/outside sign + world transform,
- a BVH for the **true** signed distance to the smooth surface in a narrow band,
  **signed by the closest face normal** (the detail that kills corduroy — an
  occupancy sign would snap crossings back to the voxel steps),
- the padded-lattice field sweep,
- `keepLargestFaceConnected` (physical one-piece guarantee, pre-mesh),
- interpolated `surfaceNetsField` + edge-connected `largestMeshComponent` + light
  Taubin.

A feature now supplies only a `combine({ d, x, y, z, voxelSize }) => number`
closure (`< 0` = inside). The Voronoi lamp is re-pointed at it as the first
consumer and shrank from ~290 lines to ~75 (`max(shell(d), strut(p))`), with
identical output — verified by the unchanged unit + e2e lamp tests.

This is deliberately a pure refactor (no new user-facing behavior). The follow-up
features each become: a new `combine` in their own module + a thin `applyX` in
`modifiers.ts` + a tab in `surfaceModal.ts` + a tool schema + a doc line. The
shared algorithm is no longer copied per feature, which is what makes the
parallel PRs safe.

Verified: `npm run build`, `npm run test:unit` (54 surface tests incl. a new
`sdfModifierMesh` test), the e2e voronoi suite, and the deps/deadcode gates.
