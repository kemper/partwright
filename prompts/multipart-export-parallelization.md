---
session: "cpf91h"
timestamp: "2026-07-07T17:45:00Z"
model: claude-opus-4-8
---

## Human

When we're doing a multipart export, can we parallelize the rendering or the
preparation? I'm exporting a 16-part project (dummy armor) and it seems to do it
all one at a time. My laptop is powerful — doing all 16 at once would probably
be fine, but even assuming parallelism of 8, or detecting the machine's
capabilities so we base it on that (is there a browser API for that?). Either
way, let's add some parallelization. And it'd be cool if there was a progress
bar per part as it's rendering, so we can see the status of each part as it
exports and prepares.

## Assistant

## Key decisions

**Reused the existing worker pool instead of building a new one.** Discovery
turned up `src/geometry/enginePool.ts` (`buildInPool`/`disposeEnginePool`) —
already a disposable pool of `engineWorker.ts` instances behind a job queue,
built for the Assembly view. The main editor's single long-lived `engineWorker`
serializes all `execute` calls on one thread, so firing concurrent
`executeCodeAsync` at it gives no real speedup; the pool is the mechanism that
actually parallelizes. Routing the export bake through it was far lower-risk
than refactoring the hot single-worker path.

**All four export bake loops now share one parallel helper.** The 3MF UI flow,
the OBJ/STL/GLB UI flow, and the two console/AI API twins (`bakePartsForExport`,
`build3MFPartsExport`) each had their own serial `for … await
bakeColoredMeshForPart` loop. Consolidated into `bakePartsParallel(parts,
{onStatus, cancel})`, which sizes the pool, fans out via `Promise.all`, is
order-preserving, drops no-geometry parts, never fails the batch on one part's
error, and disposes the pool in a `finally`.

**Removed a real concurrency hazard.** `bakeColoredMeshForPart` mutated the
shared `setActiveImports` global around `executeCodeAsync`; under concurrency
that races. Switched it to pass imports/companions **explicitly** per
`buildInPool` call (the pool already threads them straight onto the postMessage),
so parallel bakes can't stomp each other's imports.

**`paintOps` passthrough.** `PoolBuildResult` didn't carry `api.paint.*` ops, so
a naive pool route would have dropped in-code paint from exports. Extended the
pool result + `handleMessage` to pass `paintOps` through (the worker already
posts it); the existing 3MF painted-parts tests confirm colours survive.

**Machine-based sizing via `navigator.hardwareConcurrency`.** New
`renderer.exportPoolSize` config (default 8, surfaced in Advanced Settings),
clamped at runtime to `hardwareConcurrency − 1` and to the part count — so it
answers the "assume 8 / detect the machine" ask. Threaded into the shared pool
via a new `setEnginePoolSize` override (reset on dispose so it never leaks to a
later Assembly build).

**Per-part progress UI is a new modal.** The shared `progressModal` is a single
aggregate bar; per-part status needed new UI. `src/ui/exportProgressModal.tsx`
shows one row per part (queued → rendering → done/failed), each with its own
bar — indeterminate/animated while rendering (a single WASM mesh build reports
no sub-progress, so a fractional per-part bar would be dishonest) — plus an
aggregate "N of M" bar and a Cancel button. `onStart` (fired when a worker pulls
a job off the queue) drives the queued→rendering transition.

**Test fix.** `export-cancel.spec.ts` asserted the old `progress-modal-cancel`
selector; updated it to the new modal's `export-progress-cancel`. Verified the
real flow end-to-end in the browser (8-part STL export) — screenshot posted.
