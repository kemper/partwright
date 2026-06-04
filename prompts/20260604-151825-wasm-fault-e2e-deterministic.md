---
session: "ecstatic-sagan"
timestamp: "2026-06-04T15:18:25Z"
model: claude-opus-4-8
tools: [Bash, Playwright, Edit, Write]
sequence: 2
---

## Human

(PR #423 CI) The e2e shard failed: tests/engine-wasm-fault-recovery.spec.ts
timed out at 30 s on the CI runner — both the original and the retry.

## Assistant

## Key decisions

**Why it failed** — the spec forced a *real* OOM via `Manifold.sphere(10, 100000)`.
That's a CPU grind whose timing depends on the host memory ceiling: it trapped in
~0.1 s on the constrained sandbox but ran past Playwright's 30 s timeout on the
roomier CI runner (it was still building the giant sphere, not yet trapping).
Probed other triggers — manifold-3d *gracefully* rejects malformed input
("Not manifold", 1–4 ms); only genuine heap exhaustion traps, and that is always
a slow, machine-timing-dependent grind. So a real-OOM e2e can't be a reliable gate.

**Redesign** — simulate the kernel's exact trap message instead of exhausting the
heap: sandbox code `throw new Error('memory access out of bounds')` flows through
the *identical* recovery path — caught in the engine's `run()` try/catch, returned
as an `execute_result` error, classified by `isFatalWasmFault`, and recycled — so
it deterministically exercises the wiring in ~6 s. Assertions: (1) the actionable
"ran out of memory" hint surfaces, (2) the "Recycling geometry Worker after fatal
WASM fault" log fires — the regression guard for the recycle, **verified to fail
on pre-fix code**, and (3) the next run recovers. No production test seam added;
the simulation rides the real code path.
