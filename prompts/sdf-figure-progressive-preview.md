---
date: 2026-06-19
branch: claude/nifty-hamilton-cjwk3v
files_changed:
  - src/geometry/sdf.ts
  - src/geometry/engineWorker.ts
  - src/geometry/engine.ts
  - src/config/appConfig.ts
  - src/ui/advancedSettingsModal.tsx
  - src/main.ts
  - tests/unit/sdf.test.ts
---

## Human

Catalog figures take a long time to render (sometimes >10s). Could we render them
in low quality first and let a higher-quality render keep running in the background,
or warn the user / gate mesh-altering actions behind a full-quality render?
Investigate, report options, then (after picking a direction) implement.

## Assistant

Investigated where the 10+s goes: figures are SDF models (`api.sdf.figure(...).build(
{ edgeLength, detail })`) lowered via `Manifold.levelSet` (marching cubes). The cost
is the fine march over a large bbox PLUS per-detail-sphere refine passes — not
Three.js, not paint. `edgeLength` is the only quality lever and it's hard-coded in
each model's own code; the Settings "quality" preset (circularSegments) has zero
effect on SDF.

Weighed two real options with hard numbers. Baking meshes into the catalog (instant
load, no recompute) was rejected: measured on real figures, even meshopt+16-bit-quant
is ~1.2MB median / 1.8MB max per figure (~250MB+ repo bloat uncompressed), which the
user explicitly didn't want. Went with **progressive coarse→fine** (zero download
cost), mirroring the existing SCAD two-phase `onPreview`/`execute_preview` path which
already runs end-to-end to the viewport.

Implementation:
- `sdf.ts`: module-level `setSdfPreviewScale(n)` — when set, `buildSdf` multiplies the
  march `edgeLength` by it and drops every `detail` region (the two expensive parts).
  Plus `sourceUsesSdfBuild(code)` so only SDF code pays for a second pass.
- `engineWorker.ts`: for manifold-js code that does an SDF `.build()`, run a throwaway
  coarse pass first → post `execute_preview` (reusing the SCAD message), then the full
  pass → `execute_result`. Both runs are synchronous and back-to-back so no newer
  execute can interleave; the preview's live Manifold is freed.
- `engine.ts`: send `sdfPreviewScale` only when an `onPreview` consumer exists AND the
  run is manifold-js (config-driven, `renderer.sdfPreviewScale`, default 2.5).
- `main.ts`: extend the preview callback from SCAD-only to manifold-js, add a viewport
  "⚡ Fast preview — rendering full quality…" pill (status indicator, not a toast) that
  clears when the full mesh lands/errors/cancels, and gate `commitSurfaceModifier`
  (the mesh-altering bake chokepoint) so it refuses while the preview is on screen —
  the user's "force full quality before altering the mesh" ask.
- `appConfig.ts` + `advancedSettingsModal.tsx`: typed `sdfPreviewScale` knob (1 = off).

Why 2.5×: measured 24s→1.1s (ballerina), 42s→1.5s (chef), 13s→0.4s (grandpa) — 20-30×
faster, coarse mesh stays watertight + single-component, and the silhouette/pose are
fully recognizable (verified headlessly and in a real browser; the coarse ballerina
shows the raised-O arms, arabesque leg, tutu, and base, with face/hand detail filling
in on the full pass). Higher scales risk thin limbs vanishing in the preview.
