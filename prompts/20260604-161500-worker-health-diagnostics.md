---
session: "happy-goldberg-l8nz2"
timestamp: "2026-06-04T16:00:00Z"
model: claude-opus-4-8
tools: [explore, playwright]
---

## Human

A different AI session is adding WASM heap tracking to the diagnostics
menu. Can I add more diagnostics — see my web workers, their memory usage,
their health, etc.? Recommend new diagnostics given this app's architecture,
then (follow-up) proceed with the recommended diagnostics panel upgrade.
The other AI put info in the data section; leave/ignore that.

## Assistant

## Key decisions

**Scope: worker health, not heap.** Heap/memory is owned by the parallel
session, so this PR deliberately stays in the worker-health lane to avoid a
collision: liveness, in-flight load, (re)start counts with the last restart
reason, and a geometry run-history with wall-clock vs worker-side timing.

**New leaf module `src/diagnostics/workerStats.ts`.** Mirrors the
errorLog / ai-diagnostics store pattern (snapshot + subscribe). Kept as a
true leaf (imports only `appConfig`) so every worker client can record into
it without creating an import cycle — verified with `lint:deps`. The four
known workers are pre-registered with default labels so the panel always
lists them even before their lazily-loaded client module is imported; each
client re-registers idempotently to attach a live provider.

**Live providers over push-on-mutation.** Geometry in-flight load is the sum
of the ten `pending*` maps; rather than thread `setInFlight` through every
map mutation, the client registers a live provider that the panel polls
(`ui.workerPanelRefreshMs`). Keeps the hot path untouched.

**Surface silent restarts.** `restartEngineWorker` previously logged via a
bare `console.error`, which the errorLog intercepted as a generic `app`
error — even for a normal user cancel. Now it records into the worker
registry and the central Diagnostic Log with a proper `engine` source and a
level keyed to cause (cancel → info, timeout/crash → warn/error), so a
crash-loop (the OOM signature) is visible as a climbing restart count.

**Worker-side timing.** `engineWorker.ts` stamps `workerMs` on
`execute_result`; the client records each settled run (ok/error from the
worker, timeout/cancel/crash from teardown) so the panel can separate real
compute time from transfer overhead.

**Config + settings.** Added `ui.workerRunHistorySize` and
`ui.workerPanelRefreshMs` to `appConfig` with matching fields in the
advanced-settings modal, per the no-hardcoded-tuning-constants rule.

**Entry points.** Command-palette "Show worker health" + a "Workers" button
in the existing ⚠ Diagnostic Log panel header. Panel built with
`mountPreactModal` and the shared `BUTTON_*` constants.

**Verification.** New `tests/unit/workerStats.test.ts` (ring eviction, live
override, idempotent re-register, subscriber notifications). `build`,
`test:unit`, `lint:deps`, `lint:deadcode` all green. Manually exercised in
the browser: ran geometry, forced a restart, opened the panel, screenshotted
restarts:1 with reason/time and a run row showing `23ms (21ms compute)`.
