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

## Follow-up (2026-07-20)

User inspected the Twisted Checker Vase up close: checker cell boundaries were
badly jagged, and skewed cells read as "missing" pattern in places. Diagnosis:
the twist stretches triangles tangentially and the pattern assigns one color
per triangle (centroid test), so stretched slivers become long teeth at cell
boundaries; headless verification confirmed coverage is complete (all 129k
triangles patterned — nothing actually unpainted; the pale patches are rim
lighting + world-space cell skew). Model-level fix shipped: a post-deform
`refineToLength(1.0)` pass splits exactly the stretched edges (129k → 211k
tris, still under budget) — boundaries now track the true cell edge closely.
The structural fix (pattern-boundary-aware subdivision in the paint layer) is
tracked on #928.

## Follow-up (2026-07-20, catalog refresh #929)

User approved the catalog audit and asked for all 16 flagged entries to be
fixed with the new verbs, subagent-driven, with agent retro feedback captured.
14 model-sculpt agents ran in two waves (plus two direct gold-material edits);
each returned a structured retro, aggregated in
retros/inbox/2026-07-20-catalog-refresh-agent-feedback.md. Notable decisions:

- Ten entries had no examples/ source (code only in their baked JSON) — their
  code was extracted to gitignored .plans/catalog-refresh/ and re-baked from
  there, matching how those entries already live (code-in-JSON only).
- Two regressions were caught in final QC by diffing old vs new bakes: the
  christmas-tree entry's STORED code had drifted from examples/ (the stored
  variant was self-colouring; the example was an uncolored twin) — fixed by
  merging the agent's scatter improvement into the colored code and making
  that the example, healing the drift; and retro-rocket's face-picked teal
  porthole lived in stored colorRegions, which source re-bakes discard —
  restored by carrying the region into the new JSON and refreshing the
  thumbnail with catalog-fix-thumbnails.cjs (which preserves regions).
- The royal-crown re-bake ballooned 81KB→3MB because the new bake persisted
  its computed surfaceTexture; stripped post-bake to keep the catalog payload
  lean (the code recomputes the texture on open, as the original entry did).
- Rocket-ship's agent found a latent extrude(scaleTop=0) knife-edge fin bug
  and established the `round(mode:'concave')` seam-softening pattern; doc
  fixes shipped for three agent-reported traps (circularPattern radius+center,
  paint.slab one-sided band, thin-shell round radius, npm --silent for JSON).

## Follow-up (2026-07-20, D6 pip quality)

User flagged the Casino-Rounded D6's pips as still poorly painted (the
paint.box selectors read as jagged squares — the documented trade-off wasn't
good enough). Replaced paint entirely with the D20's inlay technique: each
carved recess is refilled with a slightly-oversized labeled sphere clipped to
the original die surface (`sphere.intersect(rounded)`), so the pip is a FLUSH
circular fill whose color boundary is exact boolean geometry — matching how
real casino "birdseye" dice are made. Also sized pips up to real-die
proportions (~16% of face width) and dropped the refine(3) paint workaround
(169k → 22k tris). Lesson for #928's paint items: when a paint region
coincides with carved geometry, labeled inlay geometry beats any selector.

## Follow-up (2026-07-20, D6 body waviness)

User then flagged lumps on the die BODY: api.round's lattice error reads as
gentle pillowing on large flat mirror-shaded faces. Fixed by switching the
convex body to the exact construction — Manifold.hull of eight corner
spheres (flat faces perfectly flat, fillets exactly cylindrical, 22k → 3k
tris). deform.md now documents the boundary: hull for convex rounded
boxes/prisms, api.round for shapes with no exact construction (booleans,
imports, organic forms). Flat-face waviness itself noted on #928.
