---
date: 2026-06-21
author: claude (opus-4-8)
task: Fix triangle "streak" slivers when painting with smoothed edges (PR #843)
---

## Liked
- A photo of the defect + one follow-up clue ("downward streaks close to the center") was enough to localize a subtle marching-triangles bug. The clue that the streaks aligned with the cone's *vertical mesh edges* was the key that turned "intermittent sliver" into "contour grazing a corner of a coarse, un-refined triangle."
- Delegating the first codebase sweep to the `explore` agent returned the whole smooth-paint pipeline (paintMode → refinePipeline → subdivide.clipByField) with the exact suspect function and code, so the main context stayed clean for analysis.
- Reproducing the bug **headlessly with vite-node** before touching code: a 40-line script driving the real `buildStrokeMesh` over a coarse grid, measuring per-triangle min-altitude, gave a hard number (72 long slivers → 0) that proved both the bug and the fix without a browser round-trip.

## Lacked
- `clipByField`, `buildRefinedMesh`, and `subdivideSelected` aren't exported, so the headless repro had to go through `buildStrokeMesh` (the only exported entry). A thin `__testables__` for the clip internals would have let me assert directly on the clip output.
- No existing "mesh-quality" assertion helper (degenerate/sliver detection by aspect ratio or min-altitude). I hand-rolled the cross-product altitude math twice (repro + unit test). A shared `triAspect`/`isSliver` test util would be reusable for any future tessellation work.

## Learned
- The `1e-6` crossing clamp in `clipByField` was an *anti-fix*: clamping a grazing crossing to 1e-6 off the vertex preserves the razor-thin wedge instead of collapsing it. The robust pattern is **snap-to-vertex on the shared edge** (pure function of the undirected edge → crack-free) then **drop the resulting zero-area sub-triangles** (zero coverage → no hole). Area-based dropping of *non-degenerate* slivers would crack; only snapped/collinear (exactly-zero-area) drops are safe.
- The visible-long-streak (vs invisible-tiny-sliver) distinction came from `selectByClassify`'s straight-boundary refinement skip: a straight outline grazing a *coarse* triangle reaches the clip un-refined, so the sliver spans a whole coarse cell. Tiny fine-rim slivers were always present but sub-pixel.

## Longed for
- A headless way to render the *painted* mesh (not just geometry stats) — `model:preview` renders model code, but paint regions live in the app/session layer, so the visual check still needed a Playwright screenshot. A `partwright render --paint` path would close that loop.
