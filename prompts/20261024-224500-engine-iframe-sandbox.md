---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T22:45:00Z"
model: claude-opus-5-5
tools: [subagent, git-worktree, playwright]
---

## Human

Implement "option 2" for kemper/partwright#1090 — run untrusted model code in
a separate-origin iframe sandbox — behind a setting (default off so it is safe
to merge), and measure its performance. Modes off / opaque / origin; a sandbox
host page that spawns the engine Worker and hands the app a direct
MessageChannel port; tight frame CSP; crossOriginIsolated check with a toast +
Diagnostic Log fallback; untrusted-message validation; a security e2e per mode
(IndexedDB / aiKeys / localStorage / fetch must not reach the app) plus normal
modelling (manifold-js, voxel, SCAD, BREP, Assembly pool); docs; and a
benchmark script over a production build (cold/warm start, warm-reload network
bytes, run round trips for small/200k/500k-triangle models, lazy SCAD/BREP,
memory). Keep engineWorker.ts edits minimal (another agent is doing option 1
there). Commit locally, don't push.

## Assistant

## Key decisions

**Zero edits to engineWorker.ts.** The sandboxed Worker runs a shim
(`src/sandbox/sandboxWorker.ts`) that receives the app's MessagePort, redirects
`self.postMessage` to it, re-dispatches port messages as `message` events on
`self`, and only then dynamic-imports the unmodified engine Worker. engine.ts /
enginePool.ts change one line each (`createEngineWorker(() => new Worker(...))`)
and the façade (`SandboxedEngineWorker`) is Worker-shaped, so the clients don't
know the difference.

**Classic blob bootstrap.** Chromium refuses a `{type:'module'}` blob Worker
from an opaque-origin document (found empirically: the probe never ran). A
classic blob Worker that `import()`s the module shim works in both modes, and a
blob Worker inherits the frame document's CSP — so the tight `connect-src
'self'` applies to model code without per-Worker response headers. Early
messages are parked on a global queue the shim drains. The blob base URL can't
resolve root-relative fetches (`/openscad-libs/…`, OCCT's `?url` wasm), so the
shim resolves string fetch URLs against its own module URL.

**Setting storage.** AppConfig only stores numbers/booleans, so the mode is a
per-browser localStorage value with a `VITE_ENGINE_SANDBOX` build default; the
numeric boot timeout lives in AppConfig (+ bounds + modal Field). Exposed via
`partwright.getEngineSandboxStatus/setEngineSandboxMode` (and
`getWorkerHealth`, closing a UI-parity gap the bench needed) but deliberately
not as an in-app AI tool, so a prompt-injected session can't turn it off.

**Fallback is transparent.** The façade buffers posts until the Worker's first
port message reports `crossOriginIsolated`; on failure/timeout it spins up a
direct Worker, replays the buffer, toasts once and logs to the Diagnostic Log.

**Main-thread code paths.** `exportParamSweep` and `setReferenceGeometry`
evaluated model code on the main thread via the sync `executeCode`; with the
sandbox active they now go through the (sandboxed) Worker instead.

**Bench methodology.** Fresh persistent profile per (mode, iteration) so cold
really is cold and the warm reload has a real disk cache (Playwright's default
in-memory context cache silently refuses the ~10 MB OCCT wasm, which made every
mode look cache-less). Run latency comes from the worker-health ring
(main-thread post→result vs Worker compute).

**Results in one line.** Start-up and run latency are within noise in all
modes; `opaque` loses HTTP/code-cache reuse (~0.8 MB re-downloaded per load,
~14 MB more once SCAD/BREP are used) and pays a cross-process mesh copy
(+18 ms at 500k triangles), so `origin` is the mode to deploy. The full table
is in docs/engine-sandbox.md.
