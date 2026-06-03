---
session: "pr394-paint-perf-slab"
timestamp: "2026-06-01T19:25:00Z"
tools: [Read, Edit, Write, Bash, Grep, Agent, mcp__github]
sequence: 1
reconstructed: true
---

# PR #394 follow-on: geodesic perf + slab-default painting

Continuation of work on PR #394 (projection paintbrush / BVH picking / faster
smooth-brush commit). This phase added a geodesic-reachability speedup, flipped
the default surface mode to slab (and let spray use it), synced the branch with
main, and queued a perf/WebGPU follow-up as issue #405. Reconstructed from the
session conversation; intent and decisions are faithful, wording is summarized.

## Human

Before implementing, let's talk more. Three questions: (1) Can a thin slab
always be made thin enough to never bleed through a wall? (2) If so, is there
still a use case for keeping geodesic? (3) If we optimized geodesic's crawling,
what would you propose?

## Assistant

### Key decisions

This conversation reversed my prior leaning toward "switch spray to a thin
slab." The honest analysis:

- **A thin slab can't be both bleed-proof and footprint-complete.** Two reasons.
  (a) Units are arbitrary in this app, so "below the min printable wall" isn't
  computable from geometry. (b) Curvature: the slab is a straight prism measured
  in the flat tangent plane, so on a curved surface the surface falls away by the
  sagitta ≈ L²/(2R). To cover the full brush footprint you need `depth ≥ r²/(2R)`,
  which collides with "thin enough to not punch through a thin wall." A thin slab
  therefore *under-paints* (clips the dab) on curves; a thick one bleeds. Slab
  also gates by Euclidean offset, not connectivity, so it can catch a nearby
  disconnected surface.
- **Geodesic stays worth keeping** precisely for curved/organic shapes, large
  brushes relative to curvature, and gap-separated geometry — where slab fails.
- **The geodesic slowness is point-location, not the crawl.** `reachableAt`
  (`subdivide.ts`) was calling `nearestActive`, a linear O(active) scan, for
  every refined vertex/centroid during classify + resolve → O(query points ×
  active triangles). The flood-fill itself is already local + cached.

Recommendation made to the user: optimize geodesic's nearest-triangle lookup
(behavior-preserving, fixes the real bottleneck) rather than switch spray to
slab. Offered slab-as-an-explicit-option as a possible later complement.

## Human

yes [proceed with the geodesic nearestActive optimization on PR #394]

## Assistant

### Key decisions

Replaced the linear `nearestActive` scan with a grid-accelerated nearest-triangle
lookup inside `buildGeodesicField`:

- **Bin active triangles by centroid into a uniform cell grid**, then answer
  `reachableAt` with an outward ring search from the query point's cell. Stop
  once the best hit is provably closer than anything unsearched (termination
  bound: after fully searching rings 0..R, any unsearched binned triangle's
  surface is ≥ (R−1)·cell away). Triangles larger than a cell go in an
  always-searched "oversize" list. This returns the **global-nearest** triangle,
  so reachability is identical to the scan.
- **Cell sizing by mean triangle extent, not cbrt(count)/diagonal.** First
  attempt used the `buildTriGrid` heuristic (cbrt over the 3D diagonal) and was
  only ~9× faster, because a stroke's active triangles are near-*planar*, making
  cells huge (~70 tris each). Sizing cells at ~2× the mean centroid→vertex
  distance dropped per-call cost to where the ring search terminates in a couple
  rings. Final: **~45× faster** on a dense stroke (820 µs → 18 µs/call),
  measured by temporarily forcing the linear path.
- **Threshold:** below 64 active triangles the linear scan still wins, so small
  strokes skip the grid build.
- **Tie handling:** the only divergence from the linear scan is at measure-zero
  points exactly equidistant to two base triangles (on a shared edge/vertex),
  where either pick is valid. Matching the scan's first-wins tie-break is
  incompatible with early ring termination, so I left it — query centroids are
  interior and unique; only on-wireframe points tie.

Verification (no Playwright MCP in this env — targeted e2e is the eyes-on check):
new unit test pins the grid result to a brute-force linear-scan reference over a
broad point cloud on a dense curved surface (unique-nearest byte-identical; ties
validated as a legitimate tied pick) plus a gap guarantee (never reaches a
disconnected parallel sheet). Airbrush (7/7) and smooth-brush (22/22) e2e stayed
green, including the no-bleed and save+reload determinism cases. Committed +
pushed; updated PR #394 description and subscribed to PR activity.

## Human

I was thinking slab painting would become the default for all painting and that
it would be enabled for spray painting.

## Assistant

### Key decisions

This is a deliberate product call that overrode my "keep geodesic default"
recommendation. Mapped the wiring first (via an explore agent), then confirmed
two forks with the user before building:

- **Geodesic stays a selectable option** (not removed) — keeps the curved/gap
  path and the just-merged speedup relevant.
- **Show the depth slider for spray** (default `radius×0.5`) so the curvature
  trade-off is tunable rather than hidden.

Implementation:

- `paintMode`: `brushSurface` default flipped `geodesic → slab`; the spray
  descriptor now carries the active surface instead of being hardcoded geodesic.
- Resolvers (`descriptorToStroke` in `main.ts`, `buildBrushStrokeFromDescriptor`
  in `refinePipeline.ts`): dropped the `d.spray ? 'geodesic'` override; surface
  resolves from the descriptor, defaulting to slab when absent.
- **Back-compat preserved:** old sprays were saved with `surface:'geodesic'`
  explicitly, so they reload exactly as before — verified by the determinism
  specs. Descriptors with no `surface` field (pre-feature) default to slab, which
  matches the prior back-compat fallback.
- Console APIs `paintStroke` / `paintAirbrush` default surface to slab;
  `paintAirbrush` gained validated optional `surface` + `depth` so a spray can
  pick either mode.
- `paintUI`: the Slab button stays selectable while spraying (was greyed), and
  the depth slider shows whenever slab is active.

Tests updated to the new reality rather than forced green: the airbrush no-bleed
test now covers **both** the slab depth-gate (depth < wall thickness stays on
top; deep depth reaches the back face) and geodesic connectivity; the spray-panel
test asserts Slab stays available + depth visible; the smooth-brush default
assertion flips to slab; the refinePipeline unit test asserts a spray honours its
surface (slab → normals, geodesic → reachability field) and that a surface-less
descriptor defaults to slab. Full unit tier (572) + airbrush/smooth/projection
e2e green locally; posted a brush-panel screenshot. Committed, pushed, updated PR
title + description (now five changes).

## Human

[Architecture question] An AI engineer recommended WebGPU to parallelize
computations for a separate surface-textures feature. Would that be an option
for painting? Follow-ups: when is per-point signed-distance used, and how much
could it impact UX?

## Assistant

### Key decisions (advisory only — no code changed)

- **WebGPU is not the high-leverage move for painting.** The two heaviest stages
  are a poor GPU fit (geodesic flood-fill is sequential graph BFS; adaptive 1→4
  subdivision has data-dependent output). Projection paint already uses the GPU
  (WebGL id-buffer). Only the per-point signed-distance math is embarrassingly
  parallel.
- **`strokeSignedDist` internally loops over all stroke samples** (union-over-
  samples min), so each eval is itself O(samples); it runs across the brush band
  on every smooth/spray commit (classify 3 verts + 3 edge midpoints per level,
  boundary-clip root-finding, resolve centroids). Total ≈ band triangles ×
  (~6–10 evals) × sample count.
- **UX impact is narrow.** It runs in the subdivision Web Worker, so the main
  thread never freezes — only commit *latency* is affected. Typical dabs/short
  strokes are already sub-100 ms; only the heavy tail (large radius + fine
  speckle + long drag on a dense mesh) climbs to a few hundred ms–1 s.
- **Blockers for a GPU path:** determinism (painting must reproduce
  byte-identically across save+reload, asserted by many e2e tests; GPU floats
  differ across devices), and the fallback burden (painting is core, so WebGPU
  can't be the only path → maintain both CPU and GPU implementations).
- **Cheaper deterministic levers first:** BVH-ify `deriveSampleNormals`
  (O(samples × triangles) brute force, now on the *default* slab path) by
  reusing baseRemap's BVH; and spatially index the *samples* for
  `strokeSignedDist`. Profile before any GPU work — subdivision allocation may
  now dominate instead.

## Human

I'll merge what we have but do a follow-up spike on WebGPU/WebGL later. In the
meantime update from latest main (there are changes).

## Assistant

### Key decisions

Merged `origin/main` (23 commits — Quality panel, in-app dialogs replacing
native alert/confirm/prompt, Beta pill, knip hardening) into the branch. Single
conflict in `src/main.ts` imports, resolved by **combining** both sides: main's
new `notifyQualityLangChanged` / `setQualityRenderState` (Quality panel) plus
this branch's `setTriangleToBaseMapper` / `baseTriangleOf` (projection painting).
No work dropped from either side.

Verified on the merged tree before pushing: tsc clean, 572/572 unit tests pass,
`three-mesh-bvh` dep survived the lockfile merge. knip's binary wasn't installed
locally, but its *gating* rules are deps/unlisted/unresolved (which tsc validates)
— new exports are all used, so no gating risk. Pushed the merge; local HEAD
matches remote; branch is 0 behind main.

## Human

Capture the perf/WebGPU follow-up as a GitHub issue.

## Assistant

### Key decisions

Created issue #405 with a suggested order of operations: (1) BVH-ify
`deriveSampleNormals` (cheap, deterministic, default-path win); (2) sample
spatial-index for `strokeSignedDist` if profiling shows it still dominates;
(3) WebGPU/WebGL spike only if a parallel-friendly bottleneck remains after CPU
indexing. The issue records the determinism + fallback + transfer-tax blockers,
the "profile signed-distance vs. subdivision allocation first" caveat, and a note
that the sibling surface-textures feature is a far better intrinsic WebGPU fit
(uniform output grid, result stays on GPU, looser determinism) so its conclusions
won't transfer wholesale to mesh painting.
