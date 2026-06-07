---
session: "ecstatic-sagan"
timestamp: "2026-06-04T15:03:13Z"
model: claude-opus-4-8
tools: [Read, Grep, Bash, Edit, Write, Playwright]
---

## Human

Testing a PR branch; AI built a parameterized chain and scaling it to 100
links produced an error: "memory access out of bounds … source: engine … No
stack trace or origin captured for this entry." Suspected to also exist on
main/staging. Wants to understand it and prevent it. Attached the session
JSON (3 versions; v3 = the failing 100-link run, `executionTimeMs: 1`).

## Assistant

## Key decisions

**Root cause** — "memory access out of bounds" is a `WebAssembly.RuntimeError`
trap from the manifold-3d kernel: the model is too large for the WASM linear
heap (which only ever grows, never shrinks). The deeper, reproducible defect is
that the long-lived geometry Worker is **not recycled** after such a trap. A
trap can leave the kernel's C++ state half-mutated, so every *subsequent* run —
even a trivial cube — faults instantly with the same error (the `executionTimeMs:
1` tell) until the page is reloaded. `engine.ts` only restarted the Worker on
timeout / crash / messageerror, never on a fault returned as a normal result.
Confirmed empirically in a real browser: with recycle disabled, run-3 (a cube)
fails with the same OOM; with it, run-3 succeeds.

**Fix scope** — chose graceful recovery + clearer messaging over trying to
pre-empt heavy models (can't predict the heap ceiling reliably):

- `src/geometry/workerFaults.ts` (new, dependency-free → unit tier): classifies
  fatal WASM traps (`isFatalWasmFault`) and produces an actionable, memory-aware
  hint (`wasmFaultHint`). Shared by the engine client and the sandbox engine.
- `src/geometry/engine.ts`: after delivering a result whose error is a fatal WASM
  fault, recycle the Worker (`recycleEngineWorker`) so the next run boots a clean
  module — the actual cascade fix. `console.warn` (recovery, not a second crash).
- `src/geometry/engines/manifoldJs.ts`: the OOM message previously matched none
  of the existing hint patterns (`RuntimeError`/`unreachable`), so it passed
  through raw; now it gets the memory-aware hint.
- `src/main.ts`: engine errors carry no JS stack (fault is off-thread, in WASM),
  which is why the diagnostic log read "No stack trace or origin captured."
  Attach diagnostics + language + executionTimeMs as the log `detail`.

**Verification** — `tests/unit/workerFaults.test.ts` (classifier) and
`tests/engine-wasm-fault-recovery.spec.ts` (e2e: fault → graceful error with
hint → next run recovers). The e2e fails on pre-fix code (proven by temporarily
disabling the recycle), so it's a real regression guard, not a no-op.
