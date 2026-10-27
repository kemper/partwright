---
session: "016A4CDA"
timestamp: "2026-10-27T03:10:00Z"
sequence: 2
---

## Human

yes, do log capture next

(Second deliverable of tracking issue kemper/partwright#1143. The mask
agent's feedback: "Console output from `runCode`. I debugged by throwing JSON
in an error and reading it back. A `log` return or a `debug` field in the
result would have been much cleaner.")

## Assistant

## Key decisions

**A per-run console passed as a parameter, not a patched global**: Model code
is compiled as `new Function('api', 'console', …)` (`compileModel` in the new
leaf `src/geometry/modelConsole.ts`) and called with a capturing console.
This shadows `console` for model code only. Engine internals and an
overlapping async replicad/SCAD run in the same Worker can't leak into another
run's logs, which a swapped global would allow. The parameter adds no line to
the function prelude, so syntax-diagnostic line numbers are unchanged. Output
still mirrors to the real console, so DevTools behaves as before.

**Wrap each engine's run, not every return site**: manifold-js's `run` body
moved into `runManifoldJs(code, params, console)`, and the method attaches
`logs` via `withLogs(...)`. Voxel and replicad do the same. That puts logs on
every result (success, each error branch, and throws) without touching the
dozens of early returns. Logs printed before a throw are the main debugging
case.

**Not stored in the geometry data**: `logs` rides on `MeshResult` → the Worker
`execute_result` (type-checked in workerMessageValidation, since the Worker
may be the sandboxed iframe) → `engine.ts`. In `main.ts` it lands in a
module-scope `lastRunLogs`, not in the geometry-data element, which is saved
with versions. It is returned only by run / runAndSave / setParams and by the
isolated runs (runIsolated / runAndAssert / runAndExplain).

**Readable values and capped size**: Objects print as compact JSON with cycles
and typed arrays made safe. A Manifold prints as `Manifold{tris, bbox}`
(what model code usually wants to know) and a CrossSection as its area.
Output is capped per run (200 lines / 20,000 chars) so a log in a loop can't
flood an agent's context. The caps are app-config knobs in Advanced Settings,
threaded to the Worker on the execute message because the Worker's getConfig
only sees defaults.

**Docs**: ai.md now says to debug with console.log and lists `logs` on every
run API. figure.md and sdfFigure's poseProbe doc no longer recommend
`throw new Error(JSON.stringify(...))`.
