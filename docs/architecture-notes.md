# Architecture Notes

Reference for patterns that come up when extending the app. Consult when adding new engines, top-level pages, or cross-tab features.

## Lazy WASM loading

Each non-default engine is loaded on first use via a cached promise:

- **manifold-3d** — eager on app boot (needed for `Manifold.ofMesh`, paint persistence, slicing).
- **OpenSCAD** — `await import('openscad-wasm-prebuilt')` in `openscadEngine.init()`. Triggered on first SCAD session open or first SCAD run.
- **OpenCASCADE / replicad** — `await import('replicad')` + WASM in `ensureBrepLoaded()` (`brepRuntime.ts`). Triggered by (a) `api.BREP.*` use in a manifold-js session, or (b) first replicad-language session run.
- **WebLLM** — `await import('@mlc-ai/web-llm')` in `src/ai/local.ts`. Triggered on first local-model use.

Each loader is idempotent and caches the resolved module. Vite splits each into its own chunk (verify via `npm run build` output — the OCCT WASM lands as `replicad_single-*.wasm` (~10 MB) outside the main bundle).

When adding a new lazy-loaded module, follow `brepRuntime.ts`'s pattern: one `ensureXLoaded()` promise, cached after success and cleared on failure so the next call retries.

**Loaders that run in the engine Worker must not use the global `fetch`** — it does not exist there after the sandbox lockdown (next section). Use `fetchAppAsset(url)` from `src/geometry/workerLockdown.ts` for every runtime asset (WASM side-car, library sources, fonts), and hand Emscripten modules the bytes yourself (`wasmBinary`, as `brepRuntime.ts` does for OCCT) or use an inline-WASM build (OpenSCAD) so their glue never reaches for `fetch`/`XMLHttpRequest`. Dynamic `import()` of JS chunks keeps working.

## Engine Worker sandbox lockdown (#1090)

Model code runs via `new Function('api', code)` in the geometry Worker (`src/geometry/engineWorker.ts`, also spawned N× by `enginePool.ts` for Assembly / multi-part export). The Worker shares the page's origin, so unrestricted model code could read IndexedDB (AI provider keys live there) and exfiltrate over `fetch` (CSP `connect-src` allows `https:`). Untrusted code reaches the Worker through forked share links and imported `.partwright.json` files.

How it's locked down (`src/geometry/workerLockdown.ts`):

- **When.** `engineWorker.ts` calls `lockdownGlobalScope(self)` right after the `init` handshake (manifold-3d's WASM is fetched during init, before any model code exists) and before posting `ready`. Every other message type first awaits `ensureSandboxLocked()`, so even a protocol violation (an `execute` before `init`) can't run model code on an unlocked scope. It is **fail-closed**: if `verifyLockdown` finds anything still reachable, the Worker refuses to run model code.
- **What.** Each name in `LOCKDOWN_GLOBALS` (fetch, XHR, WebSocket(Stream), EventSource, WebTransport, RTC, indexedDB + `IDB*`, caches/CacheStorage, cookieStore, Storage/Lock managers, file-system entry points, Worker/SharedWorker, BroadcastChannel, ServiceWorker containers, ShadowRealm, FontFace/fonts, Notification) is deleted from the global object **and every object on its prototype chain** (Chromium puts `fetch`/`indexedDB` on `WorkerGlobalScope.prototype`), then pinned on the global as a non-writable, non-configurable `undefined` so it can't be re-added. `NAVIGATOR_PROPS` (storage, storageBuckets, locks, serviceWorker, sendBeacon, usb/hid/serial/bluetooth) get the same treatment on `navigator`. `importScripts` and `close` become frozen throwing stubs — `importScripts` deliberately stays a *function* because the OCCT Emscripten glue detects "Worker" via `typeof importScripts == 'function'` (OpenSCAD's checks `WorkerGlobalScope`, which is kept). `onmessage`/`postMessage` are pinned as non-writable own properties so model code can't swap the Worker's handler.
- **Private fetch.** Just before removing `fetch`, the lockdown captures it **pre-bound** into module scope (never on `self` or `api`). `fetchAppAsset(url)` is the only door to it and only issues same-origin GETs of plain path-absolute URLs; its URL check (`toAppAssetPath`) uses only operations model code can't monkey-patch (typeof, primitive string indexing, comparisons), so even if model code reaches the function via `import()` of the bundled chunk it can't reach another origin or extract the native `fetch`. Outside a locked realm (main thread, Node SSR for `model:preview`, unit tests) `fetchAppAsset` defers to the live `globalThis.fetch`, so the CLI's `public/` fetch shim still works.
- **Not removable: dynamic `import()`.** It's syntax, not a global. CSP `script-src` (`'self'` + the fixed Cloudflare analytics host; no `blob:`/`data:`) bounds it to same-origin modules, and the CSP is delivered with the Worker script response, so it applies inside the Worker.
- **Main thread treats Worker messages as untrusted data.** `engine.ts` and `enginePool.ts` run every Worker→main message through `checkEngineWorkerMessage` (`src/geometry/workerMessageValidation.ts`): type allow-list, typed-array classes + lengths + triangle-index range for meshes, plain-data payloads with no `__proto__`/`constructor` keys, `api.paint.*` descriptor kinds limited to what the recorder emits. A malformed message fails the matching request with a clear error and **recycles** the Worker (its realm is no longer trustworthy); a malformed progressive preview is just dropped.

Known limits: model code shares the Worker realm with later runs in the same Worker (it can patch built-ins or add a `message` listener to observe later runs' code/imports and post well-formed forged results) until that Worker is recycled. It cannot reach the network or storage to exfiltrate what it sees. Main-thread evaluation paths (voxel paint/export grid recovery via `runVoxelForPaint`, `exportParamSweep`, `setReferenceGeometry`) are **outside** this lockdown — see #1090 for the follow-up.

Tests: `tests/unit/workerLockdown.test.ts`, `tests/unit/workerMessageValidation.test.ts`, e2e `tests/engine-lockdown.spec.ts` (hostile probes in manifold-js + voxel, forged messages, SCAD + BOSL2 + fonts, BREP lazy load + STEP export after lockdown).

## Browser history — back button preservation

`updateURL()` in `sessionManager.ts` uses `history.replaceState`, not push — intentional for in-editor updates (version switching, rename) that shouldn't pollute the back stack. But it's a trap for cross-page navigation:

- If any session-mutating function (`openSession`, `createSession`, `closeSession`, `importSessionPayload`) runs **before** you push the destination history entry, the internal `replaceState` overwrites the origin page and breaks the back button.
- **Always push the destination entry first**, then run the state change. See `handleCatalogEntryLoad` and `openSessionFromLanding` in `src/main.ts` for the canonical ordering.
- For in-page "Back" buttons on top-level pages (catalog, help), prefer `window.history.back()` when there's a real prior entry — falling back to `replace` (not push) when the page was loaded directly by URL. See `helpHasAppBackTarget` / `catalogHasAppBackTarget`.

When adding a new top-level page or cross-page navigation, walk through:
1. What's on the back stack before this navigation fires?
2. What does `window.location` look like after each async step (especially DB or session ops)?
3. Does back take the user to the prior page, not two pages back?

## Cross-tab isolation — implementation patterns

The rule: state must not bleed between tabs. The explicit exceptions are opening a session in a tab and taking control of a session in another tab.

Concretely:

- **Don't put session-scoped state in a shared localStorage blob.** AI provider/model/toggles are per-tab working state, persisted per-session on `session.aiPreference` and applied only on open/take-control — see `applySessionAiPreference`/`recordSessionAiPreference` in `aiPanel.ts` and `setSessionAiPreference` in `sessionManager.ts`. `reloadSettingsFromStorage` deliberately preserves this tab's `toggles`/`preset` when a peer tab writes the shared blob — it adopts only genuinely-global additive prefs (custom models, system-prompt overrides, panel width).
- **App-level preferences** (units, render quality, editor auto-format) use `readPerTabPref`/`writePerTabPref` (`src/storage/perTabPref.ts`): live value in sessionStorage (per-tab) with a localStorage seed so a fresh tab still inherits the last choice. Don't attach a `storage` listener that live-mirrors them.
- **`storage`-event and `BroadcastChannel` handlers** must gate on `msg.sessionId === currentState.session?.id` before acting — see `tabSync.ts` consumers and `sessionLock.ts`. Never adopt a peer's provider/model/toggles live.
- **Truly-global state** (custom local models, system-prompt overrides) is the exception and must be additive/merge-friendly so a peer tab's write can't clobber another tab's addition.
