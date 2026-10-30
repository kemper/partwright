---
date: "2026-10-16T20:45:00Z"
task: "paint tooling gaps: tolerance fix, region clean-up ops, smooth bucket fills (3 stacked PRs)"
pr: 1027
areas: [agents, testing, pr-flow, tooling, docs]
cost: medium
---

## Liked / Worked
- The existing refine pipeline (`RefineRegion.field` + `clipByField`) made
  smooth bucket fills a ~400-line pure module instead of new mesh surgery —
  "give it a signed field and it cuts exactly along it" is a great seam.
- `levelSet` meshes are a perfect in-code stand-in for scan meshes (irregular
  triangulation) — no fixture files needed to reproduce "sawtooth on a scan".
- The `work-reviewer` agent found 3 real blocking bugs (2 reproduced at
  runtime) across the stack, including a pre-existing-pattern regression in
  multi-object export I'd never have looked at. Worth running before ready.
- Disabling a fix and re-running its test to prove the test discriminates
  (z = +10 vs −10; hasRed true vs false) was cheap and made the PR claims solid.

## Lacked
- PR-checks only runs on PRs into `main` (`branches: [main]`), so stacked PRs
  get **no CI** until their base merges. Had to run the paint regression set
  locally and say so in each PR body. (cost: a ~6 min local run per layer)
- `src/main.ts` has duplicated logic that silently drifts: `descriptorRefines`
  / `collectRefineRegions` existed in both main.ts and refinePipeline.ts, and
  the worker copy had dropped the cylinder `axis` arg. Nothing flags this.
- The `triangles` descriptor's id-space contract (BASE ids, remapped on
  rebuild) is only written in `baseRemap.ts`; `paintFaces` violated it and
  regions vanished after a rebuild. Cost ~5 turns to diagnose.
- Running Playwright while a review subagent also ran Playwright caused one
  timing-flake (`paint-camera-passthrough`) — workers:1 doesn't help when two
  processes share the box.

## Learned
- `triGridFor` (subdivide.ts) sizes cells to the *volume*; on a surface mesh a
  point query visits ~800 triangles. Any per-vertex/per-triangle surface lookup
  needs a triangle-sized grid (smoothFill.ts `surfaceGrid`) — 10× faster.
- Paint undo was "pop the array"; regions also get their render `order`
  re-stamped from array position on reload, so you can't reorder the array to
  make undo work without changing layering after reload.
- Regions that leave the live list (undo, clear, stashed originals) keep stale
  triangle ids across a mesh change; re-entry must re-resolve. Now handled via
  `trianglesFor` + `takeStaleRestoredRegions`.
- Gemini coerces untyped tool params to string and an untyped `{type:'object'}`
  sanitizes to `properties: {}` (unfillable) — give objects explicit properties.

## Longed for
- A `pr-checks` trigger for stacked PRs (e.g. `branches: [main, 'claude/**']`
  or `workflow_dispatch` with a ref) so every layer of a stack gets shards.
- A tiny `npm run proof -- <spec-snippet>` helper: run a throwaway page.evaluate
  that returns `renderView` data URLs, write them to the scratchpad, and montage
  them with sharp — I hand-rolled that pipeline four times.
- A lint (ast-grep) that flags `{ kind: 'triangles', ids: [...x] }` built from
  current-mesh ids without going through the base-id helper.
