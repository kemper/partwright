---
date: "2026-11-15T04:50:09Z"
task: "fix: stop coloured 3MF imports locking the page when added to an object"
pr: 1257
areas: [import-export, testing, tooling]
cost: medium
---

## Liked / Worked
- A throwaway Playwright spec with a 25 ms `setInterval` heartbeat (records every main-thread gap) plus a CDP `Profiler.start/stop` around the import gave "where is the page blocked, and in which function" in one run. It pointed straight at `nearestIndex`.
- `runImportWorkerJob` (`src/import/importWorkerJob.ts`) made adding a third import Worker a ~40-line job.

## Lacked
- The previous freeze fix was verified with a synthetic 3MF that had no slicer config, so it never reached the colour-seeding step every real Bambu project goes through. "Stall under X ms" was measured for one entry point only. (cost: the bug shipped as fixed)
- No stock way to measure main-thread stalls for a big import; I rebuilt the heartbeat harness from scratch. (cost: ~6 turns)
- A frozen renderer also hangs `cdp.send('Profiler.stop')`, so the spec never wrote its results and the foreground wait timed out. Wrap CDP calls in a race when the page may lock.

## Learned
- `nearestTriangleMap` without `maxDistance` costs about `2·R⁴` cell visits for a query R cells away from any ref centroid, and returns -1 past `maxR`. It is only safe for meshes that coincide with the ref. Any caller whose query mesh can hold other geometry must pass `maxDistance`.
- Every import placement choice is a different code path for a seed function: new session, new object, fill an empty object, **Add to object** (composes with the object's own geometry), multi-object split, multi-file merge. A freeze fix has to be measured on Add to object too.
- `setAppConfig('renderer', 'lazyManifoldMinTriangles', 0)` makes a 12-triangle fixture take every "big mesh" path in e2e.

## Longed for
- `npm run perf:import -- <file> [--target new-object|add-to-object]`: imports a local file in headless Chromium and prints total time, each main-thread stall over 300 ms, and the top self-time functions. Would have turned the investigation into one command and would make "we fixed the freeze" checkable per entry point.
- A committed generator for big synthetic meshes with slicer-style colour data (single-filament and multi-colour), so freeze fixes are tested on what real projects look like without touching anyone's files.
