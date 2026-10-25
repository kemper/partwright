---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-19T02:30:00Z"
tools: [subagent, vitest, segment-bench]
---

## Human

Add one more part detector to the registry (#1025): `planar-groups`, UI name
"Flat & smooth faces". Seedless, aimed at mechanical / CAD-like / low-poly
parts (one part per CAD face). Smooth mode unions triangles across edges with a
dihedral under a threshold; flat mode grows near-planar groups against a
running mean normal. Params surfaces / angleDeg / minPartPct / maxParts,
presets, cached grouping stage, unit tests, a bench row, and a run on the
figurine scan.

## Assistant

## Key decisions

**Own grouping over the shared features, not `computeFaceGroups`.** The faceGroups
helper builds a different adjacency and has no allow mask; using
`MeshFeatures` edge pairs keeps the detector consistent with the others and
lets the grouping stage be cached per (mesh, mode, angle, allow mask).
`maskKey` is now exported from `autoPatches.ts` instead of duplicated.

**Replaced the `absorbSmallRegions` step with a smallest-first agglomeration.**
The first version used `absorbSmallRegions` + a raised threshold for
`maxParts`. On the jittered bench meshes it left 16k-24k parts: every speck
moves to a neighbour label simultaneously, so two small mutual neighbours just
swap labels forever. A heap-driven merge (fold the smallest face into the
neighbour sharing the most boundary, until every face is >= minPartPct and at
most maxParts remain) makes the cap exact and is also faster on noisy input.
Isolated pieces can't merge, so they may exceed the cap.

**Allow contract falls out for free**: unallowed triangles never join a group,
so region adjacency never touches them and no re-masking is needed.

**Not opted into autoPropose**: on organic meshes smooth mode fuses everything
and flat mode shatters it, so it should only run when the user picks it.

**Honest description**: it says outright that it is poor on organic sculpts and
noisy scans.
