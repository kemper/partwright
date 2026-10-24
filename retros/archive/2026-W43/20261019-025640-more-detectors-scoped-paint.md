---
date: "2026-10-19T03:05:00Z"
task: "feat: more part detectors (thickness, planar-groups, random-walker) + paint within a part"
pr: 1037
areas: [segmentation, paint, subagents]
cost: medium
---

## Liked / Worked
- Fanning three detectors out to `implementer` subagents in worktrees, each
  with a precise algorithm spec plus a real-mesh eval command (`partwright
  segment <stl> --seeds … --png`), ran three duels in parallel while I built
  scoped paint. The registry design (one entry → panel, API, AI schema, CLI)
  made merging them nearly mechanical.
- `segment:bench` gave every worker the same objective scoreboard; all three
  reported comparable IoU tables without being told how to compare.
- The `work-reviewer` pass caught four real blockers I'd missed. The worst was
  a lineage WeakMap whose values held their parent mesh strongly: ~1 GB
  retained after 20 smooth strokes. Worth running before every ready flip.

## Lacked
- The worktree `isolation` started agents at the previous merge (bc0cb22),
  not my local HEAD (d623aa2). Every agent had to re-checkout; the prompt
  saying "verify your base" saved it.
- Two agents independently found and fixed the same `absorbSmallRegions`
  swap bug, in incompatible ways. A shared helper with a known defect in
  flight needs one owner; I only reconciled it at merge time.
- `partwright segment` crashed without `--views` (null vs undefined default
  arg), so every headless detector eval was broken until fixed.

## Learned
- Paint label ids index the run mesh, but smooth strokes, stamps and worker
  rebuilds re-tessellate the working mesh one step at a time. Each refine
  path hands out a parent→children map relative to a different parent: base,
  previous current, or the worker input. Anything that maps run-mesh ids onto
  the live mesh must compose those steps. A flat child→root Int32Array per
  mesh is the cheap form.
- A detector with `seeds: 'optional'` receives the draft's automatic per-part
  pins (`auto: true`) on every re-run, preset and rerun op, so it must filter
  them or it silently flips into seeded mode.

## Longed for
- `partwright segment --diagnostics` (print `DetectorResult.diagnostics`).
  Two workers wrote throwaway probe scripts to read per-stage timings.
- A `segment:bench --only <detector>` flag. The full bench re-runs every
  config on every model, minutes per tuning step.
- A ground-truth STL fixture for groove-less splits (limbs vs torso). The
  bench's labelled figures all have grooves, so it can't show where
  `thickness` should win.
