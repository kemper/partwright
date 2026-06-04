---
session: "8fTQp1"
timestamp: "2026-06-04T16:00:00Z"
model: claude-opus-4-8
tools: [explore, playwright]
---

## Human

Now that we have a counter for how long rendering has taken and a cancel
button/link, I don't think we need a render timeout of 60 seconds anymore.

## Assistant

## Key decisions

**Scope — remove the timeout from the render path only.** The 60s ceiling was
`geometryTimeoutManifoldMs`, applied in `executeCodeAsync` (engine.ts). The
elapsed-time counter (`#run-elapsed`) + "× Cancel" button (`#btn-cancel-inline`
→ `cancelCurrentExecution` → `restartEngineWorker`) now let the *user* bound a
slow render, which is strictly better than auto-killing legitimately-heavy work
at an arbitrary wall-clock limit. Removed the timer from `executeCodeAsync` for
all three engines (the Cancel UX is engine-agnostic), not just manifold-js — a
per-engine inconsistency would be incoherent.

**Kept the safety timeouts on non-render Worker ops.** SCAD validation /
include-detection and STEP export/import/cleanup have *no* Cancel affordance, so
a silent WASM hang there would wedge the UI with no recourse. Those keep their
timeouts. Renamed the helper `getExecuteTimeoutMs(lang)` →
`getWorkerOpTimeoutMs('scad'|'replicad')` to reflect that it no longer governs
the render path.

**Removed the now-dead `geometryTimeoutManifoldMs` config.** It was only read by
the manifold-js render path; with that gone it would have become a no-op setting
in Advanced Settings. Dropped the field from `AppConfig`, `APP_CONFIG_DEFAULTS`,
and the settings modal, and reworded the scad/replicad field docs + tooltips to
say they guard background Worker ops (render is not timed out). The config merge
ignores stored overrides for removed keys, so this is back-compatible.

**Verification.** Build + 600 unit tests pass. A throwaway Playwright spec
confirmed: a normal render still resolves correctly; a multi-second boolean
chain surfaces the elapsed counter + Cancel button and runs past the old 60s
ceiling without being killed; clicking Cancel cleanly restarts the Worker and
returns the UI to ready.
