# Partwright Scenes — generative composition

A **scene** is a deterministic arrangement of many copies of a few small parametric **assets** (trees, rocks, crates, buildings…) scattered across a region by a layout algorithm. `generateScene` does NOT add a new engine, schema, or runtime concept: it **generates ordinary manifold-js code** that returns one `Manifold.compose([...])` and commits it through the normal `runAndSave` path. The result is a regular version in the current part — it exports, paints, forks, and renders exactly like any hand-coded model.

Because it's just generated code, re-rolling a scene is cheap: call `generateScene` again with a new `seed` (or a lower `density`).

## What you pass — the SceneSpec

```js
partwright.generateScene({
  seed: 7,
  assets: [
    {
      id: "tree",                       // identifier-safe: /^[A-Za-z_][A-Za-z0-9_]*$/, unique
      footprintRadius: 3,               // approx XY radius, used for overlap rejection
      baseHeight: 0,                    // optional: where the asset's base sits vs z=0
      // `body` runs inside `function buildAsset_tree(p) { <body> }` and MUST return a Manifold.
      // `p` holds this instance's sampled param values (emitted as literals — NOT api.params).
      body: `
        const trunk = Manifold.cylinder(p.trunkH, 0.6, 0.5, 12);
        const crown = Manifold.sphere(p.crownR, 16).translate([0, 0, p.trunkH]);
        return trunk.add(crown);
      `,
      params: [                          // same ParamSpec shape as api.params({...})
        { key: "trunkH", type: "number", default: 8,  min: 5, max: 12, label: "trunk height" },
        { key: "crownR", type: "number", default: 3,  min: 2, max: 5,  label: "crown radius" },
      ],
    },
  ],
  layout: {
    kind: "poisson-disk",                // grid | jittered-grid | poisson-disk | clustered | along-path
    bounds: { min: [0, 0], max: [80, 80] },
    density: 0.01,                       // higher => more candidate points
    scaleRange: [0.8, 1.4],              // per-instance uniform scale
    rotationJitter: 180,                 // ± degrees about Z
    minClearance: 1,                     // extra spacing added to each footprint
    // optional: spacing/jitter (grid), clusters/clusterSpread (clustered),
    // path/pathSpacing (along-path), zones (polygon clipping + per-zone assetWeights)
  },
  ground: { enabled: true, thickness: 1, margin: 4 },  // optional slab under the scatter
  maxInstances: 300,                     // default 400 cap
  label: "forest",
});
// -> { seed, code, graph: {requested, placed, rejectedOverlap, bounds}, geometry, version, galleryUrl }
```

Per-instance variation comes from `params` sampling, `scaleRange`, and `rotationJitter` — each instance gets its own values, emitted as literals into the generated code (a single `api.params` call resolves ONE global value set per run, so it can't drive per-instance variation). Instances sharing an identical `(assetId, paramValues)` combo are **baked once** and reused, so the per-instance cost is dominated by the number of *unique* combos, not the raw instance count.

## The loop: generate → critique → render → refine

1. **generateScene** with a first guess.
2. **critiqueScene** — returns structured metrics from the just-generated graph plus the live geometry: `{ instanceCount, componentCount, overlapCount, scaleVariance, heightVariance, footprintCoverage, floatingCount, clippingCount }`. No args. Call it right after `generateScene`.
3. **renderViews** for the visual verdict — `critiqueScene` is the numbers, `renderViews` is the eyes. Use both.
4. **Refine** and re-call `generateScene`:
   - `overlapCount` high or `footprintCoverage` near/over 1 → lower `density` or raise `minClearance` / `footprintRadius`.
   - `scaleVariance` ~0 but you wanted variety → widen `scaleRange`.
   - `floatingCount` > 0 → an asset hovers; lower its `baseHeight` or author the body sitting on z=0.
   - `clippingCount` > 0 → an asset pokes below ground; raise `baseHeight` or enable/raise `ground`.
   - Composition feels wrong → bump `seed` to re-roll the same controls.

## Layout kinds

- **grid** — regular lattice at `spacing` (or derived from `density`). Most even, least natural.
- **jittered-grid** — grid + per-cell `jitter` (fraction of spacing). Natural but still roughly uniform.
- **poisson-disk** — blue-noise scatter, guaranteed minimum spacing (`2*maxFootprint + minClearance`). The best default for organic fields.
- **clustered** — `clusters` gaussian blobs of `clusterSpread`. Use for groves, debris piles, towns.
- **along-path** — instances resampled every `pathSpacing` along a `path` polyline. Use for hedgerows, fences, roadside trees.

`zones` (optional) clip placement to polygons and/or bias the asset mix per zone via `assetWeights` (`{ assetId: weight }`).

## Performance

Keep `maxInstances` modest (default cap 400). Cost scales with the number of **unique (asset, params) combos** (each is baked once), not the instance count — so a forest of 300 trees with 6 distinct param combos bakes 6 builders and composes 300 cheap transforms. Reach for fewer, coarser assets and tighter param ranges when a scene is slow.
