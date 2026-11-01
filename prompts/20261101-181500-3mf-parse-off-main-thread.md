---
date: 2026-11-01
branch: claude/bold-gates-qx2zed
files_changed:
  - src/import/parsers/threemf.ts
  - src/import/importWorkerJob.ts
  - src/import/threemfParseWorker.ts
  - src/import/threemfParseClient.ts
  - src/import/stlProbeClient.ts
  - src/main.ts
---

## Human

I imported a large 3MF while a large STL of the same model was already open,
and the page froze and went unresponsive. How can we prevent that bad user
experience? (Shared the NED_V2 3MF via Google Drive — ~45 MB zipped; the STL
is ~187 MB, ~3.7M triangles.)

## Assistant

## Key decisions

**Root cause**: the STL import already parses + probes in a Worker, but the
3MF path called `parse3MF` on the main thread. The Drive file was private, so
I reproduced it with a synthetic 3.7M-triangle 3MF (44 MB zip, 274 MB XML):
`parse3MF` takes ~20.6 s of synchronous work and then the quick
`isOrientedEdgeManifold` check adds ~1.1 s. Measured in the browser over an
open 2M-triangle STL: the longest main-thread stall was 19.0 s on main and
116 ms with this change.

**Fix**: run the parse in a short-lived Worker (`threemfParseWorker.ts`),
which also does the edge-manifold check and transfers the mesh buffers back.
The interactive import shows the standard cancellable progress modal (Cancel
terminates the Worker), and the multi-file reader forwards progress too.
`parse3MF` gained an optional `onProgress` (coarse stages plus XML-scan
fraction, reported every ~4M chars so small files pay nothing).

**Shared runner**: the STL probe client's Worker runner (ready-then-hand-off,
progress, terminate-on-abort/settle) moved to `importWorkerJob.ts` so both
Workers share one implementation (no copy-paste drift). Its errors now say
whether the payload had reached the Worker: only a Worker that never started
falls back to parsing on the main thread — a file that fails to parse is
reported, not re-parsed slowly on the UI thread.

**Bytes ownership**: interactive imports transfer the file buffer zero-copy;
API/multi-file callers get a copy, since some re-read the bytes afterwards.
