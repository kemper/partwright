---
date: "2026-11-15T19:25:36Z"
task: "fix: stop hardening an import's vertex arrays on every run"
pr: 1275
areas: [tooling, testing, import-export]
cost: low
---

## Liked / Worked
- Five `console.log` timing marks inside the engine Worker (run start, harden, model code, getMesh, facts) found a 10 s cost in one run. Playwright's `page.on('console')` relays Worker logs, so no CDP session on the Worker was needed.
- Running the render-only wrapper (`api.renderMesh`) next to the solid wrapper was the tell: it builds nothing and still took 9.4 s, so the time could not be `Manifold.ofMesh`.
- `partwright.getWorkerHealth().runs[].workerMs` gives Worker-side time without main-thread noise, which made a timing test with a 4× margin practical.

## Lacked
- The sandbox perf test (`tests/ses-bench.spec.ts`: trivial cube, sphere union, levelSet, an SDF figure) has no case with an imported mesh, so a cost linear in import size went unnoticed. The earlier "why is the browser 3× slower than Node" question sat as an open issue for most of a day because nothing timed the steps before the model code.
- Comparing against Node (`vite-node`) hid the problem: Node never installs the hardener.

## Learned
- SES `harden` on a typed array lists every index as an own key. Anything large on a run's `api` must sit behind an accessor and be locked by hand (`sealBulkRecords` in `src/geometry/modelEval.ts`). Now in `docs/architecture-notes.md`.
- The sandbox's reachability and shared-state walkers followed data properties only, so anything behind an accessor was invisible to them. They now read `api`'s own accessors.

## Longed for
- A per-run timing breakdown in `getWorkerHealth()` (`setupMs`, `modelMs`, `meshMs`, `factsMs`), always on. This bug would have been one glance at the Diagnostics panel instead of an investigation.
- A perf case in `tests/ses-bench.spec.ts` with a multi-million-triangle synthetic import, so sandbox changes are measured against bulk data too.
