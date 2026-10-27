---
date: "2026-10-25T17:30:00Z"
task: "fix: keep the app responsive when importing or switching huge STL meshes"
pr: 1130
areas: [import-export, renderer, testing, tooling]
cost: medium
---

## Liked / Worked
- Profiling instead of guessing: a throwaway Playwright spec that attaches a CDP
  `Profiler` session, adds a 20 ms `setInterval` heartbeat, and prints the
  longest busy stretch's top inclusive frames. It pinned every stall in one or
  two runs: string-keyed weld, 5× re-parse, main-thread `ofMesh` after each
  run, `EdgesGeometry` in thumbnails, the per-switch thumbnail, and the idle
  adjacency prewarm.
- `E2E_PORT` plus a `git worktree` of origin/main gave a same-machine
  before/after (109 s → 55 s) without touching the branch.
- The `work-reviewer` pass caught three real issues the e2e suite couldn't:
  - the Worker fallback was dead once the bytes were transferred;
  - Simplify's open forced the deferred build;
  - stale facts when the deferred build fails.

## Lacked
- No performance budget or harness for big meshes. Every heavy main-thread
  pass (`ofMesh` after every run, `EdgesGeometry`, adjacency prewarm,
  thumbnail-on-switch) had crept in silently, because no test imports
  anything bigger than a cube.
- The headless renderer is SwiftShader, so GPU-side numbers (readback, buffer
  upload, unattributed "(program)") are inflated. The profile can't tell you
  how much of a gap a real GPU would remove. (~2 turns spent separating
  JS-busy from GPU time)

## Learned
- After every run, `main.ts` rebuilt the result as a main-thread `Manifold`
  (`Manifold.ofMesh`) purely for stats and the slice/decompose APIs. It is now
  lazy (`liveManifold()`), with stats from the engine Worker
  (`manifoldFacts`). Any new code that needs the solid must go through
  `liveManifold()`, never `currentManifold`.
- `requestIdleCallback` doesn't make a long task cheap: one 1.6 s callback is
  still a 1.6 s freeze.

## Longed for
- A `npm run perf:import -- <file.stl>` script: import a file through the real
  UI, print heartbeat gaps plus the top inclusive frames of the longest busy
  stretch, and optionally run the same thing against origin/main via a
  worktree for a before/after table. I hand-built this twice this session.
- A CI perf smoke test that imports a generated ~1M-triangle sphere and fails
  if any main-thread busy stretch exceeds N ms, so the next eager pass gets
  caught at PR time.
