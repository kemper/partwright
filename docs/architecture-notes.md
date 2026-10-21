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

## New Worker-client checklist — the init/ready/error handshake

Every message-passing Worker client in this repo (the geometry `engineWorker.ts`, `surfaceWorker.ts`, `engraveWorker.ts`, a new per-part pool worker, …) follows the same handshake: the client posts `{type:'init'}` first and the Worker replies `{type:'ready'}` before it will accept any real work message (`execute`, `apply`, …). Skipping this on either side doesn't throw — it silently hangs. Concretely, when adding a new Worker client:

1. **Post `init` and await `ready` before the first work message.** A worker that receives `execute` before `init` replies `{type:'error', message:'... not initialised'}` — it does *not* reject the pending promise on its own; the client must be listening for the `error` message type and treat it as a rejection.
2. **Every request needs a matching response handler for both the success type and the `error` type.** A client that only wires up the success case (e.g. `Promise.all` awaiting per-worker `execute` results) will hang forever, not throw, when a worker never reaches `ready` or emits `error` instead of the expected type — there is no built-in timeout.
3. **Pool workers replicate the handshake per-worker.** A worker pool doesn't get to skip `init`/`ready` for the sake of the pool abstraction — each pooled worker instance still needs its own handshake before it's handed work.

If a `Promise.all`/`Promise.race` awaiting Worker results hangs with no error surfaced, the missing handshake (or a missing `error`-message handler) is the first thing to check — add a temporary `console.warn` in the message handler rather than guessing.

## `src/main.ts` scope model — module scope vs. `main()` setup scope

`src/main.ts` mixes two scopes. A long run of module-level functions near the top of the file (e.g. `openAssembly`, `syncAssemblyToggle`) are reachable from anywhere in the module, including `window.partwright` wiring. But most per-tool UI wiring — `selectPart`, part-selection helpers, every tool-close callback — is declared *inside* the large `async function main()` (the app's setup function), not at module scope, because it closes over local DOM/state built during setup.

Before adding a helper that needs to call into per-tool wiring (e.g. something that calls `selectPart`), check which scope its neighbors actually live in — don't assume module scope just because a sibling like `openAssembly` is there. If the helper also needs to be reachable from module-scope code (a `window.partwright` method, another module-level function), the working pattern is: declare a `let` at module scope, assign the real closure to it from inside `main()`, and have module-scope callers invoke the variable (see `applyAssemblyChrome`, assigned inside `main()`, called from `openAssembly`/`closeAssembly` at module scope via `applyAssemblyChrome?.(...)`).

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
