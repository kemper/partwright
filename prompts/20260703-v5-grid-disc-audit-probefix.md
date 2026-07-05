---
date: 2026-07-03
branch: claude/confident-carson-gpo63q
files_changed:
  - src/main.ts
  - src/geometry/rayCast.ts
  - src/color/symmetry.ts
  - tests/unit/symmetry.test.ts
  - tests/unit/meshIslands.test.ts
---

## Human

Keep iterating toward Opus 4.8 agents succeeding at the Pomni paint task;
implement filed issue #881 plus the best proposals from two ideation
subagents (agent-workflow lens + geometry-kernel lens). PR size is fine;
quality of the end result is the goal.

## Assistant

Second slice — the identification, aiming, and verification layer.

**`renderRegionGrid` (#881.2).** One labelled contact sheet of up to 64
region highlights (accepts `detectRegions().regions` verbatim). The
island subset is computed once and shared across tiles, so the "which of
these 20 regions is the iris?" pass costs one image read instead of 20
render round-trips. Tiles with zero in-frame triangles are labelled
"(0 tris!)" in red so an empty highlight can't masquerade as a finding.

**`paintDisc` + `shape` on `paintInOrientedBox`.** The oriented sphere/
cylinder/cone selector existed end-to-end internally (descriptor,
resolver, smooth refine) but was never exposed — `findShapeTriangles`
was reachable only by the UI. `paintInOrientedBox` now takes `shape`,
and `paintDisc({center, normal, radius})` computes the local-Y→normal
quaternion itself, making it the no-math facial-feature primitive
(iris/pupil/blush discs on a dome, painted largest-first so compositing
produces rings without annular geometry).

**`auditPaint`.** Deterministic whole-scene audit: per-region connected-
component fragments (the "yellow drip" detector — a stray blob <10% of
the main one and >5% of the model diagonal away is flagged suspicious),
later-order-wins occlusion replay (`hiddenFraction` catches "bangs 40%
overwritten"), and unpainted-island detection ("one of eight cuffs never
painted"). Numbers, not pictures — the agent gates on them and only
spends a render when a flag fires.

**`probePixel` matrix-staleness fix + island handshake.** The root cause
of four rounds of hand-derived coordinates: cameras from
`buildViewCamera` never got `updateMatrixWorld()` on the probe-only path
(renders looked right because `renderer.render` updates matrices), so
raycasts fired from the right position with identity orientation and
systematically missed — the "±10-20px estimation error" miss messaging
masked it. One-line fix in `rayCast.probePixel`. On top of that,
`renderIsland`/`renderRegion` now return a `probeView` token carrying
their exact camera spec (+ `island`), and `probePixel` accepts it,
raycasting the island subset and remapping the hit's triangle id back to
full-mesh index space — closing the see→click→paint loop on the only
views where a flat print plate is legible.

**`src/color/symmetry.ts`** (built by a subagent to spec): axis-aligned
bilateral plane detection scored by reflected-nearest-centroid residual
over a spatial hash, mirror-sibling island pairing, and triangle-set
mirroring. Wired into the API in the next slice (`paintMirrored`,
`listComponents.symmetry`).
