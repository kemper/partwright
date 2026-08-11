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

## Worker client protocol — init/ready/error handshake

`engineWorker.ts` (and any other dedicated Worker) requires an explicit `{type:'init'}` message and replies `{type:'ready'}` before it will accept `execute`/other work messages. A worker sent `execute` before `init` returns `{type:'error', message:'Geometry engine not initialised'}` — a **message**, not a rejected promise — so a client that only listens for a resolved/rejected `execute` result will hang forever with no error surfaced. Any new worker client (e.g. a Worker pool) must: (1) do the `init`→`ready` handshake before dispatching work, and (2) handle the `error` message type explicitly, not just the success reply. See the pool client in the Multi-part Assembly view for the pattern.

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
