---
date: "2026-06-15T15:55:00Z"
task: "feat: add 20 full-body figure catalog entries showcasing the figure API"
pr: 693
areas: [catalog, figures, agents, tooling]
cost: high
---

## Liked / Worked
- **Verifying the whole bake pipeline (model:preview + xvfb colored bake + thumbnail) BEFORE fanning out 10 subagents** paid off immediately — the authoring agents were never committed to a broken path, and the one-figure smoke bake took ~1 min.
- **`--require-labels` on `scripts/build-catalog-entry.cjs` is the real quality gate.** It caught 8/20 defects that `model:preview` reports as perfectly clean: buried/aliased eyes, a label-wipe, and component splits. Without it, half the batch would have shipped with blank eye sockets or unpainted regions.
- **A shared `.plans/figure-authoring-guide.md` that every subagent read** kept 10 independent Opus agents consistent (eyes-at-top-level, faceDetail, weld-vs-label, prop helpers) without repeating it 10× in prompts.
- **Single-writer discipline** (subagents author + verify only; orchestrator owns all git/bake) meant zero working-tree races across 14 concurrent agents.

## Lacked
- **`model:preview` (Node SSR) and the browser bake disagree on `componentCount` and never validate paint-label resolution.** Subagents reported `componentCount:1, isManifold:true` with confidence, but the browser bake split the same code into 5 components (marginal welds) and found 0 paintable triangles for eyes. The authoring agents had no way to see this — they were verifying against the wrong oracle. (~half the total cost was the fix wave this caused.)
- **The `coils` hair texture aliases into disconnected islands in the browser build at the coarse `edgeLength` (~0.68) the tri-budget forces** — fuses fine in SSR. Cost a multi-component failure that took bisection to find.
- **My own eye-fix recipe (`eyeEdgeLength: head*0.004`, `irisEdgeLength: head*0.002`) backfired** — exploded one model to 465k tris / genus 680 and still didn't fix a *buried* (vs aliased) pupil. Buried-vs-aliased is the key distinction: a pupil tucked behind an `upper` lid under `gaze:'up'` needs a gentler gaze, not a finer grid.
- **`SendMessage` to running subagents isn't available here**, so I couldn't course-correct the 4 fix-agents mid-flight when I discovered the recipe was explosive — had to let them self-correct and review after.
- **Heavy bake contention**: 4 concurrent subagent bakes + my own against one dev server produced repeated transient `page.evaluate: Execution context was destroyed` flakes. Needed retry-with-backoff loops.

## Learned
- **The colored bake is the only correctness oracle for a catalog figure** — paint-label resolution AND browser-vs-SSR component count both only surface there. `model:preview` is fine for proportions/pose, not for "will this paint / stay one piece in the app."
- **A trailing `smoothUnion(prop)` over a fully-labelled figure wipes ALL paint labels** (smooth blends can't carry labels). Hard-union the prop instead (build it to overlap, so it stays one component while preserving labels).
- **Eyes get *buried* by prominent cheekbones (`cheek > ~1.2`)** — the cheek skin SDF wins over the eyeball at every depth. Fix by exposing the eyeball (lower cheek / enlarge / proud), not by meshing finer. Diagnose by walking the SDF field along the eye axis, not by guessing.
- Closed-lid meditation eyes legitimately paint 0 triangles — drop eyes/iris/pupil from that figure's require-labels rather than "fixing" it.

## Longed for
- **A headless paint-label-resolution check** (the one thing only the slow xvfb bake provides) that subagents could run as fast as `model:preview`. If `model:preview` reported per-label paintable-triangle counts and used the browser-faithful mesher (or at least flagged marginal welds), the 8-figure fix wave would have been zero.
- **`api.sdf.figure` guard rails for the two traps that bit every agent**: a warning when a `smoothUnion` would drop labels on a labelled node, and a faceDetail auto-bump (or warning) when an eye/mouth feature resolves below the paint grid. Both are silent today.
- **A documented note in `figure.md`/`CLAUDE.md`** that hair *textures* (`coils`/`strands`) need `edgeLength ≤ ~0.4` and will split into islands at the coarser tri-budget grid in the browser — so authors choose smooth hair when they must stay coarse.
