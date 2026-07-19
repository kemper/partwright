---
date: 2026-07-19
branch: claude/partwright-blender-desktop-k36saj
files_changed:
  - src/geometry/scatter.ts
  - src/geometry/deform.ts
  - src/geometry/sculpt.ts
  - src/geometry/meshSdf.ts
  - src/geometry/meshSdfOps.ts
  - src/geometry/meshOps.ts
  - src/geometry/engines/manifoldJs.ts
  - src/geometry/types.ts
  - src/geometry/engineWorker.ts
  - src/geometry/engine.ts
  - src/geometry/textGlyphs.ts
  - src/color/colorPattern.ts
  - src/renderer/materialSpec.ts
  - src/renderer/viewport.ts
  - src/export/animation.ts
  - src/main.ts
  - src/ai/tools.ts
  - src/ai/systemPrompt.ts
  - src/tools/previewModel.ts
  - scripts/cli/preview.mjs
  - public/ai.md
  - public/ai/deform.md
  - public/ai/colors.md
  - examples/* (5 new showcase models)
  - public/catalog/* (5 new baked entries)
---

## Human

Asked which Blender features/capabilities are worth porting to Partwright —
powerful for AIs to drive, and fitting the friendly TinkerCAD-alternative,
code-as-source-of-truth product. After a survey grounded in what already
existed (SDF twist/bend/shell, surface textures, paint patterns), agreed on a
two-tier list and asked for **all of Tier 1 + Tier 2 in one PR, plus catalog
entries showcasing the new functionality**.

## Assistant

The organizing decision: everything portable from Blender had to serialize as
**one declarative line of model code** — that's what keeps it AI-drivable,
versionable, and re-runnable. That filter shaped every design below; stateful
editing (freeform sculpt strokes, edge-loop modeling) was explicitly rejected.

Key decisions:

- **Sandbox-first architecture.** Six of the eight features (scatter, deforms,
  sculpt, round, smoothWeld, checker pattern) live entirely in the Worker
  sandbox as `meshOps` extensions — zero session-schema changes, zero main.ts
  surgery, and they work headlessly in `model:preview` for free.
- **`round`/`smoothWeld` are voxel-lattice SDF morphology, dependency-free.**
  The existing surface-modifier SDF scaffolding is main-thread (three-mesh-bvh),
  unusable in the geometry Worker. Instead: scanline rasterizer + separable
  Felzenszwalb EDT + open/close (for radius-true rounding) or smooth-min (for
  welding), lowered back through `Manifold.levelSet` over a trilinear sampler.
  First renders showed half-voxel "corduroy" (the exact artifact
  sdfModifier.ts warns about); fixed with one separable binomial blur of the
  field — visually verified before/after.
- **Deforms auto-refine.** `warp` on a coarse mesh shows no curve at all, so
  every deform runs `refineToLength` first (default ~2° of arc per edge) with
  a 3M-triangle budget that throws by name instead of hanging the Worker.
- **`api.material` records like `api.paint`, so no schema change.** The spec
  rides `MeshResult.materialSpec` through the Worker and re-applies on every
  run because it lives in the code. Two rendering fixes found via screenshot
  verification: metals need a per-material `envMapIntensity` boost (studio env
  is tuned low for the matte default), and env-less contexts (software
  rasterizer / Light off) need a metalness clamp or metals render black.
- **Sculpt flatten falloff is tangential, not 3D** — a unit test caught that
  3D falloff weakens the press exactly where the surface bulges most.
- **Animation export records real-time playback** (MediaRecorder on the canvas
  stream) instead of frame-stepped encoding — no encoder dependency; anything
  expensive (param-sweep meshes, explode part concatenation) is precomputed
  before recording starts. Explode offsets concatenated component meshes in
  pure JS — no per-frame booleans.
- **Chat-AI parity = docs, not tools.** All new modeling verbs are code-level,
  reachable through the existing runCode/runAndSave tools; exports have never
  been chat tools. So parity work went into `/ai/deform.md` (new readDoc
  subdoc), ai.md decision-tree/meshOps/console sections, and the system prompt.
- **Headless preview gained `api.text` support** (font preload + Node fetch
  shim + opentype ESM interop) — pre-existing gap the text-on-mug showcase
  tripped over; fixed in the preview path rather than worked around.
- Showcase models were authored by parallel model-sculpt subagents against the
  new APIs, then baked into the catalog with the dev server up.
