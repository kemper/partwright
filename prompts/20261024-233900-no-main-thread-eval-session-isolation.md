---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T23:39:00Z"
model: claude-opus-5-5
sequence: 3
---

## Human

Close the remaining #1090 holes in this PR instead of leaving them as
follow-ups. (1) Move `runVoxelForPaint` (voxel paint activation, voxel
export grid recovery) into the engine Worker and return the grid. (2) Switch
`setReferenceGeometry` to `executeCodeAsync`, keeping its `{error}` contract.
(3) Assert in tests that no main-thread path invokes model code: make the
main-thread entry points throw and keep validateCode compile-only. (4)
Recycle the engine Worker between sessions, forks and imports so session A
can't observe or forge results for session B. Keep it cheap and measure it;
dispose pool workers between sessions too. (5) Fix the legal wording if it's
now inaccurate, and keep it honest.

## Assistant

## Key decisions

**Voxel grid as data, not re-execution.** The Worker's voxel run now returns
the grid itself (`VoxelGrid.toTransfer`: Float64 keys + Uint32 colours +
surfacing, transferred zero-copy). The main thread rebuilds it with
`VoxelGrid.fromTransfer`, which re-validates every key and colour and sends
surfacing back through `smooth()`'s own validator. I cached the last render's
grid (`lastVoxelRun`, keyed on the code and Customizer values) instead of
making every export async: the VOX/STL/OBJ/3MF export functions, the
`exportVOX` API and the `activateVoxelPaint` API are synchronous, and existing
specs call `activateVoxelPaint()` without awaiting it. Exporting the last
render's grid matches how mesh exports already use `currentMeshData`. The
Voxel Studio button (already async) falls back to a new `voxel_grid` Worker
message when the cache is stale. The sync API returns a "run the model first"
error instead. The cache match accepts the editor's auto-formatted form of the
run's source, because `partwright.run(code)` stores the raw string while the
editor holds the formatted one.

**Main-thread refusal.** `assertModelCodeRealm()` throws whenever a `document`
exists. It is called at every engine entry point that evaluates model code;
Node CLIs have no document and keep working. The synchronous `executeCode` is
deleted. `paint-buried-triangle.spec` called `manifoldJsEngine.run` from the
page, so it now goes through `executeCodeAsync`.

**Isolation by trust domain, lazily.** `setEngineTrustDomain(session id +
epoch)` is set on session change. `claimEngineWorker()` recycles a Worker
that ran model code for another domain before the next request is posted,
and a Worker that never ran model code is reused. The BREP clear calls that
already fire on session change start the fresh Worker early. A merge import
bumps the epoch, so merged objects boot in a fresh Worker. After that they
are part of the session's trust domain. I chose session-level rather than
object-level domains: per-object recycling would lose worker-only BREP STEP
imports on every object switch and add a reboot to each switch. The e2e spec
measured the first run in a new session at about 210–310 ms, against about
12–21 ms warm. The pool is disposed on every session change.

**Legal text.** Updated: code now runs in a worker cut off from the network
and storage, with a fresh worker per session. It still says plainly that this
is a restriction, not a hardened sandbox.
