---
date: "2026-10-17T00:19:00Z"
task: "feat: part detection foundation for imported meshes"
pr: 1028
areas: [tooling, import-export, ai-panel, testing]
cost: medium
---

## Liked / Worked
- Getting ground truth for free from labelled examples (`api.label` → per-triangle
  truth via the manifold-js engine under Vite SSR) made a real benchmark cheap;
  it overturned my own default (auto normal smoothing) within one run.
- `importMeshData` + `exportSTLData` let an e2e spec build a fused test mesh
  in-app instead of hand-triangulating an STL fixture.

## Lacked
- No way to get per-triangle label truth out of `previewModel` — had to call
  `manifoldJsEngine.run` directly in a new SSR entry.
- `text=Ready` can appear before `window.partwright` is assigned; a spec's
  first `page.evaluate` hit `undefined`. Cost: one CI-style retry locally.

## Learned
- `Manifold.ofMesh({…, runIndex, runOriginalID})` with ids from
  `Manifold.reserveIDs` keeps those runs through booleans — a cheap way to turn
  any per-triangle partition into real labels without `asOriginal()`.
- `saveVersion` carries the previous version's imports forward unless you pass
  `importedMeshes` explicitly — any commit path that changes imports must pass it.
- Spreading a 400k-element typed array into `Math.max(...a)` blows the stack.

## Longed for
- A shared e2e helper `waitForPartwrightApi(page)` (Ready + API present) so
  specs stop re-learning the race.
- A `previewModel` option returning `labelMap` per triangle, so ground-truth
  tooling (bench, eval) doesn't need its own engine entry.
