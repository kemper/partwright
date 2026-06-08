---
session: "serene-allen"
timestamp: "2026-06-08T00:22:00Z"
sequence: 2
---

## Human

Pre-release cleanup (12-agent audit, leader-verified): fix the geometry-engine
correctness findings as a topical PR off latest main.

## Assistant

## Key decisions

**Voxel grid encode/decode silently corrupted wide bounding boxes**
(`geometry/voxel/grid.ts`): `encodeGrid` lays a dense occupancy bitmap over the
whole bounding box, indexing bytes with `idx >> 3` / `(cellCount + 7) >> 3`.
Those bitwise shifts coerce to signed int32, so once the box exceeds 2^31 cells
(reachable with two voxels at opposite corners of the ±1024 range → 2048³ ≈
8.6e9) the index went negative: `Uint8Array(0)` was allocated and writes landed
on `bitmap[-1]` (a silent no-op), round-tripping the grid through `voxels.decode`
to empty/corrupt. Fixed by (a) indexing with floored division (`Math.floor(idx/8)`,
overflow-proof) and (b) capping the box at the 2^31 boundary with a clear
`ValidationError` on both encode and decode. The cap sits exactly where the old
code began to corrupt, so every box the old encoder handled correctly (< 2^31)
still encodes *and* decodes — no regression, no back-compat break — while the
pathological wide-sparse boxes above it (which also made the O(cellCount) encode
loop crawl) now fail fast. Added a unit test asserting a full-extent box throws
rather than corrupting. (Didn't add a "wide box round-trips" test: the overflow
only triggers ≥2^31 cells, where the O(cellCount) encode loop is itself too slow
to run in a unit test — and the cap throws there anyway.)

**Concurrent worker runs clobbered the shared import registry**
(`geometry/engineWorker.ts`): `self.onmessage` is `async` and `setActiveImports`
is a module-global set synchronously at message receipt, then read *after* the
lazy-init / font / BREP-preload awaits by engines that read `getActiveImports()`
synchronously at the top of their evaluation (verified `runReplicadAsync` reads
at entry with no preceding await; `manifoldJsEngine.run` is synchronous). A
second `execute` arriving mid-init overwrote the registry, so the first run
tessellated with the wrong imports. Fixed by snapshotting `runImports` per run
and installing it at the last synchronous moment before each engine reads it
(after the awaits), closing the interleaving window. Left the author's
deliberate `circularSegments` last-writer-wins design (documented at the
no-clear comment) untouched — it's independent and intentional.
