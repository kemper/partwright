---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T22:40:00Z"
model: claude-opus-5-5
tools: [subagent, git-worktree, playwright]
---

## Human

Implement "option 1" for #1090 (model code can reach fetch/IndexedDB): lock
down the engine Worker realm so user model code cannot reach storage or the
network. Remove/neutralize fetch, XHR, WebSocket(Stream), EventSource,
WebTransport, indexedDB/IDB*, caches, importScripts, Worker, SharedWorker,
BroadcastChannel, navigator.storage/locks on the global AND up the prototype
chain, permanently and idempotently, before any user code runs. Keep the lazy
engines working through a private fetch captured before lockdown (OpenSCAD,
OCCT, BOSL2, fonts, STEP). Validate Worker→main messages on the main thread.
Audit every model-code evaluation site. Unit + e2e tests; document in ai.md
and architecture-notes. Commit locally only.

## Assistant

## Key decisions

**Lockdown timing.** `lockdownGlobalScope(self)` runs at the end of the `init`
handshake (manifold-3d's WASM is fetched during init, before any model code
exists) and before `ready` is posted. Every other message first awaits
`ensureSandboxLocked()`, so even an `execute` sent before `init` can't run on
an unlocked scope. Fail closed: `verifyLockdown` must find nothing reachable or
model code is refused.

**Removal mechanics.** Each name is deleted from the global and every object on
its prototype chain (Chromium keeps `fetch`/`indexedDB` on
`WorkerGlobalScope.prototype`), then pinned on the global as a non-writable,
non-configurable `undefined`. `importScripts` becomes a frozen throwing stub
rather than disappearing because the OCCT Emscripten glue detects "Worker" via
`typeof importScripts == 'function'`; `WorkerGlobalScope` is kept because the
OpenSCAD glue checks it. `onmessage`/`postMessage` are pinned so model code
can't hijack the channel — the negative-control e2e run (lockdown disabled)
showed an unpinned `self.onmessage =` assignment wedges the Worker.

**Private fetch.** Captured pre-bound at lockdown (so calling it never looks up
`call`/`apply`, which model code could hook to receive the native function).
`fetchAppAsset` only issues same-origin GETs of path-absolute URLs; the URL
check uses primitive string indexing/comparisons only, so patching
String.prototype can't redirect it, and it stays harmless even if model code
reaches it via `import()` of the bundled chunk. Outside a locked realm it falls
back to the live `globalThis.fetch` so the `model:preview` public/ shim works.
OCCT now gets its WASM bytes as `wasmBinary` (no streaming compile — a small
cost on first BREP use, in exchange for Emscripten never touching fetch/XHR).
OpenSCAD's WASM is inlined base64, so only BOSL2 + fonts needed rerouting.

**Main-thread validation.** One pure validator (`checkEngineWorkerMessage`)
shared by engine.ts and enginePool.ts: type allow-list, mesh typed-array
classes/lengths/index ranges, plain-data payloads with no `__proto__` keys,
paint descriptor kinds limited to what `api.paint.*` emits. A malformed
message fails the request and recycles the Worker, since its realm can no
longer be trusted; malformed previews are dropped.

**Audit result.** All JS model-code evaluation in the engine engines runs in
the locked Worker, but three main-thread paths still evaluate session code:
voxel paint / voxel export grid recovery (`runVoxelForPaint`),
`setReferenceGeometry` (sync `executeCode`), and `exportParamSweep`. The last
was a cheap, contained fix (now `executeCodeAsync` in the Worker); the other two
need an async/worker-side redesign and are reported as follow-ups instead of
being folded into this change.
