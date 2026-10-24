---
session: "01CXxFpQDo4c2MfrSHT7paFF"
timestamp: "2026-10-24T20:05:00Z"
sequence: 3
---

## Human

After the selector PR merged: "do the next" deliverable of the AI-drivable
mesh-editing tracking issue (#1093) — make `api.round` / `api.smoothWeld` keep
`api.label` parts instead of dropping them.

## Assistant

## Key decisions

**Opt-in `keepLabels: true`, default off.** Both ops remesh through a lattice
SDF + `levelSet`, so the output has one fresh originalID. Carrying labels costs
a nearest-surface pass over every output triangle; keeping it opt-in leaves the
existing behaviour and timing untouched for code that doesn't need parts.

**Nearest SURFACE, not nearest centroid.** The first version matched output
centroids to input centroids and bled the head label onto a cylinder's
shoulder: cap fans are long thin triangles whose centroids sit far from the
rim. `nearestSurfaceTriangleMap` (grid over triangle bboxes + ring search with
the existing point-to-triangle distance) fixed it; a unit test pins the sliver
case.

**Re-sort into runs and round-trip through `Manifold.ofMesh`.** Provenance is
attached exactly as `api.label` produces it, so `byLabel` paint, `withinPart`,
selectors and `listObjectParts` work on the result with no special casing.
Pure logic lives in `src/geometry/labelCarry.ts` (unit-tested); the sandbox op
only does the WASM round-trip.

**Review follow-up: BVH instead of a coarse grid.** The review measured
`keepLabels` at +12.5 s on a 904k-triangle round. The cbrt-sized grid held
dozens of triangles per cell and ring 0 could never stop. A flat median-split
BVH, walked nearest-box-first and warm-started from the previous query's
answer, cut that to +5 s with identical results (brute-force checked).

**Carry only real labels.** Every Manifold carries a primitive originalID, so
the "nothing to carry" exit never fired. The sandbox's run label ids
(`activeLabelIds`, from the selector's run lookup) now gate it: an unlabelled
input returns the remesh untouched at no extra cost, and plain primitive ids
are no longer stamped onto the output.
