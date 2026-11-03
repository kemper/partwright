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

## Assistant

## CodeQL follow-up

CodeQL flagged `compileModel`'s `new Function` as "Code injection". That is
the same by-design sandbox call that used to sit in the three engine files,
now in one place, and any change to it (the new `console` parameter) yields a
fresh alert fingerprint wherever it lives. So I kept the design. The release
skill's CodeQL row now names `modelConsole.ts` as the known site, the call
site has a comment saying so, and the PR asks an admin to dismiss the alert.

## Assistant

## Review follow-up

A work-reviewer pass found no blockers. I fixed all three should-fix items:

- **BREP shapes**: `console.log(shape)` walked the entire OpenCASCADE
  Emscripten module through the wrapper's `_shape.oc`. A BREP shape now prints
  as `BrepShape`, and any object with `HEAP8`/`HEAPU8` prints as
  `[WASM module]`.
- **`runAndSave` race**: it now snapshots the run's logs right after
  `runCodeSync`, so a run started during the save's awaits can't replace them.
- **Declaring `console`**: top-level `const console` collides with the new
  parameter. `compileModel` rethrows that SyntaxError with an explanation, and
  ai.md says `console` is reserved like `api`. Renaming the parameter wouldn't
  fully fix it (a `var` shim still collides with `const`).

I also took the nits:
- The formatter is now a small recursive clone with an ancestor path, so a
  shared reference no longer prints as "[Circular]", nested Errors print, and
  depth is capped.
- The Worker installs the log caps next to `setActiveImports`, after the
  lazy-init awaits.
- help() lists `logs?` on every run API.

## Assistant

Added a 4-Ls retro for this PR (retros/inbox/20261027-033500-model-code-console-logs.md).

## Human

It won't let me dismiss the alert how do I work around it

## Assistant

## Leave the sandbox's `new Function` lines untouched

CodeQL fails a PR only on alerts that are new compared with main. The new
alert came from changing the sandbox call (moving it into `compileModel` and
adding a `console` parameter). So the engines' `new Function('api', …)` lines
are back byte-for-byte as on main: manifoldJs.ts, voxel.ts and replicad.ts are
identical to origin/main, and so is the release skill.

The per-run console now works without a parameter. `createModelLog().run(fn)`
points the console's log/info/debug/dir/table/warn/error/assert methods at the
run's capture for the duration of `fn`, then restores them. The Worker wraps
each JS engine call in it. Model code only ever runs synchronously; replicad's
async run evaluates the code before its first await. So no other run can
interleave, and if someone later adds an await before the model call, the
logs are just not captured, never misattributed.

Side effects:
- The per-message caps global and the "`const console` collides" problem are
  gone.
- Engine-internal console output during the call is captured too, which is
  run output anyway.
- A failed assert mirrors through the original `console.error` (Node's
  `console.assert` prints via `warn` and would be captured twice).
