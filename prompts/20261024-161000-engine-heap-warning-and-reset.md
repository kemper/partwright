---
session: "019z9T3o"
timestamp: "2026-10-24T16:10:00Z"
---

## Human

The AI hit "memory access out of bounds" while modeling (WASM heap 4078 MB /
4096 MB, ~3.9 s into the run). The model recovered, but could this have been
avoided? After my analysis: go ahead with the warning + ai.md guidance, and
include the auto-reset too.

## Assistant

## Key decisions

**Diagnosis**: The heap really hit the wasm32 ceiling (100%), so it wasn't a
fragmentation fault. Recovery already worked: the Worker is recycled on a fatal
WASM fault. The gap was that the agent had no signal before the crash. The
heap reading was in `engineMemory`, but no warning fired, and `ai.md` said
nothing about memory.

**One threshold drives both the warning and the reset**
(`geometry.engineHeapHighPct`, default 50%, 100 disables). The heap figure is
the Worker's grown heap size, a high-water mark that persists across runs.
Resetting at the same threshold that warns means a run reporting ≥ threshold
must have grown the heap itself. Otherwise the previous run would already have
triggered the reset. So the warning is always about *this* model, never left
over from an earlier one.

**The reset is conservative**: it only fires when the Worker is idle (no other
calls in flight). It is skipped while the Worker holds BREP state (pending STEP
imports, the retained replicad shape for STEP export) that a teardown would
lose; that state is tracked by main-thread flags. It logs at `info`, not
`warn`, because it's routine housekeeping, not a failure. Measured cost: the
next run takes about +250 ms to boot the fresh Worker, and only after runs over
2 GB.

**Warning lives in `engineMemory.ts`** (pure, unit-tested) and is appended in
`geometryWarnings` using `lastEngineHeapBytes`. All callers pass the live run's
geo, so the two agree.

**ai.md "Memory budget" section**: rough triangle costs (measured: a 128-segment
sphere is 8192 tris), prove-it-small-first, explicit low segments for small or
hidden round parts (called out as the one sanctioned downward override of the
preset), `compose` for disjoint parts, no intermediate queries in build loops,
and "halve, don't retry" after an OOM.

**Not done**: the parallel `enginePool` (Assembly view / multi-part export) and
headless `model:preview` don't get the warning; the pool is disposable and
Node has no comparable heap readout wired up.
