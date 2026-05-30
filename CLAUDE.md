# Partwright — AI-Driven Browser CAD Tool

## Quick Start

```bash
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/ (runs tsc first — also the type-check)
npm run test:unit    # Fast vitest unit tier (pure-logic, no browser) — ~1s
npm run test:e2e     # Playwright browser suite (auto-starts dev server)
npm test             # Both tiers: unit, then e2e
```

Open `http://localhost:5173/editor` to go straight to the editor. AI agents drive the tool via the `window.partwright` console API and see geometry by calling the render tools (`renderViews`/`renderView`), so there is no special view to preselect.

Requires COEP/COOP headers (configured in vite.config.ts) for SharedArrayBuffer / WASM threads.

## Deployment

Hosted on **Cloudflare Pages**. Three branches map to three environments, wired together as a **quality-gate pipeline** so each environment means something distinct:

| Branch | Cloudflare env | URL | What it is |
|--------|----------------|-----|------------|
| `main` | preview | `main.mainifold.pages.dev` | bleeding edge — every merge, deployed **before** the e2e gate runs (may be red) |
| `staging` | preview | `staging.mainifold.pages.dev` | last commit that **passed** build + unit + e2e (known-good) |
| `production` | production | `www.partwrightstudio.com` | released; promoted by hand, protected, requires PR review |

**The pipeline:**

1. Feature PRs merge into **`main`** (the integration branch). Cloudflare deploys the main preview immediately on push — that preview is intentionally *pre-test*, so it can be broken.
2. On every push to main, the **`Gate main → staging`** GitHub Action (`.github/workflows/staging-gate.yml`) runs `npm run build`, `npm run test:unit`, and `npm run test:e2e`. **Only if all pass** does it fast-forward `staging` to that commit, which Cloudflare then deploys to the staging preview. A red gate leaves `staging` parked on the last known-good commit.
3. **Release is manual:** once you've validated the staging preview, open a PR from **`staging` → `production`** and merge it. Cloudflare deploys `production` to `www.partwrightstudio.com`.

> **Feature work now targets `main`, not `staging`.** `staging` is written only by the gate Action — never push to it or open a PR into it directly. `production` is written only by the manual release PR.

Feature work follows a **draft-PR-first** flow: open the PR as a draft the moment the implementation looks good, and PR-checks runs the full suite — build + unit *and* the e2e shards — on every push, draft or ready. Marking the PR ready for review is a review-readiness signal, not a CI trigger; your task is done once every PR-checks shard goes green. The full sequence:

1. **Start from the latest `main`.** Before writing any code, run `git fetch origin main` and base your feature branch on `origin/main`. Do this at the *start* of the task, not just before the final push.
2. **Implement** until the change looks good and working by your own lightweight checks (render/stat verification, a quick read-through of the diff). You needn't run the slow e2e suite locally yet — CI runs it on the draft once it's up.
3. **Pre-flight, then push a draft PR.** Re-sync with the latest main (`git fetch origin main`, then merge `origin/main` into your branch, or rebase onto it if the branch hasn't been pushed yet, resolving conflicts), run the fast `npm run build` + `npm run test:unit` to catch type errors and logic regressions, push the branch, and open the PR into `main` **as a draft** (`create_pull_request` with `draft: true`). Keep the pre-flight light — build + unit only; let CI run the slow suite. The PR-checks CI (`.github/workflows/pr-checks.yml`) runs build + unit **and** the sharded `npm run test:e2e` shards on every PR push, draft or ready — so the full suite fires on the draft immediately, no need to flip to ready first. See [Pull Requests](#pull-requests--open-a-draft-when-the-work-looks-good).
4. **Watch the full suite green on the draft.** PR-checks runs build + unit + the 3 e2e shards on every draft push — no flip to ready required. Subscribe to PR activity, follow the shards, and run any deeper or manual verification the change warrants alongside CI. Fix failures on the same branch (each push re-runs build + unit + e2e). Only fall back to local `npm run test:e2e` if you need a tight loop on a failure CI surfaced. **The task is not done until every PR-checks shard is green.** See [After Opening a PR](#after-opening-a-pr).
5. **Mark the PR ready for review.** Once every PR-checks shard is green and your own light checks (render/stat verification, code review of the diff) look good, mark the PR ready (`update_pull_request` with `draft: false`). This is purely a review-readiness signal — CI already ran on the draft, so flipping to ready doesn't re-run it.
6. After the feature PR merges to `main`, the staging gate runs the full e2e suite; on green it advances `staging`, which auto-deploys to the staging preview. Once validated there, open a PR from `staging` → `production` for the production release.

> **Always start from — and re-sync against — the latest `origin/main`.** Branches cut from a stale main produce noisy diffs and merge conflicts, and can quietly clobber recently merged work. Re-fetch and merge/rebase `origin/main` right before pushing the draft, and again before marking the PR ready or opening any `staging` → `production` PR.

### Pull Requests — open a draft when the work looks good

When an implementation looks good and working, **open a draft pull request into `main`** — don't wait until you've run the slow verification. This is a standing instruction that overrides any default "don't open a PR unless explicitly asked" behavior: treat "the implementation looks done" as the authorization to open the draft. Don't pause to ask whether to create one, and don't report a task as done without it.

Open it as a **draft** (`create_pull_request` with `draft: true`) after a fast pre-flight only — re-sync `origin/main` and run `npm run build` + `npm run test:unit`. **Defer the slow `test:e2e` run and any deeper verification until after the draft is up** (see [After Opening a PR](#after-opening-a-pr)); the draft PR is what *kicks off* that verification phase. PR-checks runs the full suite — build + unit **and** the e2e shards — on every draft push, so you watch e2e on the draft itself. Marking the PR ready for review (`update_pull_request` with `draft: false`) is a review-readiness signal, not a CI trigger. The task is done once every PR-checks shard is green.

Skip the PR only when the user explicitly scoped you away from it — a request to "just commit" or "push to the branch" is *not* a request for a PR — or for a pure throwaway experiment. If you genuinely can't tell whether the work is a complete, reviewable unit, ask. Follow the [commit & PR conventions](#commit--pr-conventions) below for the title, prefix, and labels.

- **Build command:** `npm run build`
- **Output directory:** `dist/`
- **SPA routing:** `public/_redirects` (`/* /index.html 200`)
- **Headers:** `public/_headers` (COEP, COOP, CSP) — Cloudflare Pages serves these automatically
- **Environment variable:** Set `SITE_URL` in Cloudflare Pages dashboard (Settings > Environment variables) to the production URL (`https://www.partwrightstudio.com`). This is used at build time by the `absoluteUrls` Vite plugin to make Open Graph image URLs and canonical links absolute. If `SITE_URL` is not set, the plugin falls back to `CF_PAGES_URL` (provided automatically by Cloudflare Pages for each deployment).

## Tests — two tiers

The suite is split into a fast unit tier and the browser e2e tier. Run the
right one for what you touched; run both before marking a PR ready.

```bash
npm run test:unit              # vitest, pure-logic, no browser — ~1s
npm run test:e2e               # full Playwright browser suite
npm test                       # unit then e2e
npx playwright test --grep "AI chat"   # one e2e describe block
npx playwright test --headed   # watch the browser run (local only)
```

### Unit tier (vitest)

`tests/unit/**/*.test.ts`, run by `vitest run` (config in `vitest.config.ts`,
node environment). This tier is **only for dependency-free, pure-logic
modules** — e.g. `src/ai/patch.ts`. It never boots a browser, dev server, or
WASM, so it's the right home for any helper that can be imported and called in
isolation. If a module needs browser APIs (`fetch` stubbing, IndexedDB, the
real DOM), it does **not** belong here — keep it in the e2e tier as a
`page.evaluate(() => import('/src/...'))` test (see `tests/ai-providers.spec.ts`,
which exercises the provider request builders, SSE reader, and system-prompt
assembly in a real browser).

### E2E tier (Playwright)

`tests/*.spec.ts`, run against a Vite dev server Playwright starts
automatically. **Run this whenever you touch UI, routing, or anything in
`src/ai/` or `src/ui/ai*`** — it covers landing → editor → AI panel toggle →
key modal → toggle pills → ai.md serving, plus paint/export/import flows.

Each e2e test boots WASM in its own browser page, which is CPU-heavy, so the
suite runs **serially on any single machine** (`playwright.config.ts` pins
`workers: 1`). Running pages concurrently on one box starves the renderer and
produces 30s timeout flakes — verified empirically, so don't raise `workers`
without re-checking flake rates. Parallelism comes from **sharding across CI
jobs** instead: both `pr-checks.yml` (pre-merge) and `staging-gate.yml`
(post-merge) run `npx playwright test --shard=i/3` in a 3-way matrix, so
every shard is itself serial and contention-free while wall-clock time
drops ~3×. `testMatch` is pinned to `**/*.spec.ts` so the unit
tier's `.test.ts` files stay out of the Playwright run.

See `docs/playwright-guide.md` for sandbox vs laptop Chromium binary detection and Playwright agent gotchas.

## Smoke Test — Verifying the App Works

Run `/smoke-test` to manually verify these flows after touching routing, Vite config, index.html, or initialization code.

## AI Agent Workflow & API Reference

For the full Manifold/CrossSection API, `window.partwright` console API, session workflow, verification patterns, and photo-to-model workflow, see `public/ai.md`. The legacy `window.mainifold` alias remains available for older prompts.

### In-app AI chat — four providers

The right-side AI drawer can drive Partwright through any of:

- **Anthropic (cloud)** — user pastes their own API key (`src/ai/anthropic.ts`). Streams from Anthropic's hosted Claude with prompt caching on the long system prompt + tool list.
- **OpenAI (cloud)** — `src/ai/openai.ts`. Raw `fetch` with SSE streaming; no extra SDK. Routes per model: reasoning models (`gpt-5*`, `o1/o3/o4`) use the Responses API (`/v1/responses`); all others use Chat Completions (`/v1/chat/completions`). See `docs/ai-internals.md` for routing details.
- **Google Gemini (cloud)** — `src/ai/gemini.ts`. Raw `fetch` against `generativelanguage.googleapis.com` with SSE streaming via `:streamGenerateContent?alt=sse`; no extra SDK. Requires careful handling of `functionResponse.response` (plain object, not JSON string) and `thoughtSignature` echo-back. See `docs/ai-internals.md` for thought-signature and routing details.
- **Local (WebGPU)** — runs a model entirely in the browser via [WebLLM](https://webllm.mlc.ai) (`src/ai/local.ts`). The user opts in from the AI settings modal and the weights download once into the browser cache. No API key, no network traffic per turn.

API keys live in IndexedDB (`aiKeys` store, keyed by provider). `ChatToggles` carries a separate model id per provider (`anthropicModel`, `openaiModel`, `geminiModel`, `localModel`) so switching providers preserves each one's previous selection — see `activeModel(toggles)` in `src/ai/types.ts`.

All providers share the same chat loop (`src/ai/chatLoop.ts`), the same tool schemas (`src/ai/tools.ts`), and the same `public/ai.md` system prompt (or its slim local variant) — only the request transport differs. `chatLoop` dispatches by `toggles.provider` via an if/else chain at the streamTurn call site. The WebLLM SDK is still loaded via dynamic `import()` so users who stick with hosted providers never pay the ~6 MB chunk download.

See `docs/ai-internals.md` for per-provider thinking/auto-continue wire-format details (thinking box, thought signatures, thinking level mappings, auto-continue implementation, OpenAI routing).

#### Cross-provider review

A "👁" button in the panel header opens `src/ui/aiReviewModal.ts`. The user picks a **different** provider/model than the one driving the chat, optionally types a focus prompt, and the reviewer is sent the current code + geometry stats + 4-iso snapshot + session notes via a single non-tool turn. The response lands as a `'review'` `ChatBlock` rendered with a distinct purple-bordered bubble in the transcript AND a `[REVIEW from <provider> / <model>] …` session note (so the primary agent picks it up on its next turn via `getSessionContext()`).

#### AI Call Log (per-provider diagnostics)

A "🩺" button in the panel header opens `src/ui/aiDiagnosticsModal.ts`. Shows the last 50 provider API calls from an in-memory ring buffer (`src/ai/diagnostics.ts`): provider/model/kind, duration, status, full error messages (errors auto-expand), token usage, stop reason, request summary. Filter (all/errors/successes), Clear, Copy JSON. This is distinct from the app-wide **Diagnostic Log** (`src/diagnostics/errorLog.ts`, toolbar ⚠ button) which captures uncaught errors/console warnings; the AI Call Log adds per-call detail (successes, tokens, the "empty_final" non-error case) the general log intentionally doesn't. To avoid double-listing, the AI Call Log mirrors to `console.info`/`console.debug` (not `warn`/`error`), and hard provider errors reach the app-wide log via `chatLoop`'s `onError → errorLog.capture({source:'ai'})`.

#### Adding a new hosted provider

Run `/add-provider` for the full 7-step integration checklist.

Key rules:
- **Always use sessions** for user-requested geometry — never create files in `examples/`
- Code must `return` a Manifold. Sandbox: `const { Manifold, CrossSection } = api;`
- Shapes must volumetrically overlap by 0.5+ units to boolean-union correctly
- Use `runAndSave(code, label, {isManifold: true, maxComponents: 1})` to validate+commit
- Use `getSessionContext()` when resuming a session to read notes and version history first
- Log design decisions with `addSessionNote("[PREFIX] ...")` — prefixes: `[REQUIREMENT]`, `[DECISION]`, `[FEEDBACK]`, `[MEASUREMENT]`, `[ATTEMPT]`, `[TODO]`
- API methods validate their arguments — no type coercion, unknown keys rejected. Value-returning methods return `{ error }` on bad input; void setters throw. See `public/ai.md#argument-validation`

## Architecture

Static site, no backend. Vanilla TypeScript + Vite.

- `src/geometry/engine.ts` — Engine dispatcher + Worker client. Owns the `engines` registry (`manifold-js`, `scad`, `replicad`) and routes `executeCode*` calls to the right engine on the Worker side.
- `src/geometry/engineWorker.ts` — The Worker. Lazy-inits each non-default engine on first use and dispatches `execute` / `validate` / `exportSTEP` messages.
- `src/geometry/engines/manifoldJs.ts` — manifold-3d sandbox. Exposes `api = { Manifold, CrossSection, Curves, BREP, ... }` to user code. `BREP` is `null` until `ensureBrepLoaded()` runs in the Worker (triggered by `sourceUsesBrep(code)`).
- `src/geometry/engines/openscad.ts` — OpenSCAD WASM via `openscad-wasm-prebuilt`, lazy-loaded on first SCAD session.
- `src/geometry/engines/replicad.ts` — BREP/replicad engine for full BREP-language sessions. The returned BREP shape is retained in `lastShape` so `exportSTEP` can grab it. Imported STEP files appear in `api.imports[0]` as `BrepShape` (separate from `api.meshImports` for STL); the pending-imports list lives in `brepRuntime.ts` so it survives across runs.
- `src/geometry/brepRuntime.ts` — Lazy loader + chainable `BrepShape` wrapper. The single source of truth for "is OCCT loaded?" and `getBrepNamespace()` — used by both the manifold-js sandbox (Phase C — `api.BREP.*`) and the replicad engine (Phase A — full BREP session). Also houses `parseStepBlob` and the pending-BREP-imports side-channel used by the STEP import flow.
- `src/renderer/viewport.ts` — Three.js interactive viewport
- `src/renderer/multiview.ts` — Offscreen multi-angle render API (`renderViews`/`renderView`/`renderCompositeCanvas` for thumbnails)
- `src/editor/codeEditor.ts` — CodeMirror editor
- `src/ui/layout.ts` — Split-pane layout
- `src/ui/toolbar.ts` — Top toolbar (JS / SCAD / BREP language toggle)
- `src/ui/commandPalette.ts` — Command palette (⌘K/Ctrl+K): action registry + searchable overlay
- `src/ui/shortcutsOverlay.ts` — `?` keyboard cheat sheet (renders `shortcutDefs`)
- `src/geometry/crossSection.ts` — Z-slice to SVG/polygons
- `src/export/gltf.ts` — GLB export
- `src/export/stl.ts` — STL export
- `src/export/obj.ts` — OBJ export
- `src/export/threemf.ts` — 3MF export (ZIP-packaged XML)
- `src/import/parsers/stl.ts` — STL import (binary + ASCII)
- `src/import/codegen.ts` — Generates `Manifold.ofMesh(api.imports[i])` wrapper code
- `src/import/importedMesh.ts` — Active-imports register exposed to the sandbox as `api.imports`

### Modeling engines (three of them)

Partwright supports three language/engine pairs. The mesh-side pipeline below the engine boundary (painting, render, ray-cast, export, queries) is engine-agnostic — anything new that lives there works across all three.

| Language | Engine | Kernel | Unique features |
|---|---|---|---|
| `manifold-js` (default) | manifold-3d | mesh | `warp`, `levelSet`, `smoothOut`, `Curves` helpers, fast booleans on weird shapes |
| `scad` | OpenSCAD via `openscad-wasm-prebuilt` | CSG | BOSL2 (`threaded_rod`, `spur_gear`, `cuboid(rounding=)`, …) |
| `replicad` | OpenCASCADE via `replicad-opencascadejs` | BREP | True selective edge fillets/chamfers, STEP export, exact surfaces |

**Two ways to reach BREP** — these are deliberately complementary, not competing:

- **Phase C — `api.BREP.*` inside a manifold-js session.** The BREP namespace is exposed as a sandbox value whenever the user's code mentions `BREP` (detected by `sourceUsesBrep(code)` in `engineWorker.ts`). The Worker calls `ensureBrepLoaded()` before evaluation, and the loaded namespace flows into `api.BREP` via `getBrepNamespace()` inside `manifoldJs.ts`. BREP shapes inside this path get tessellated via `BREP.toManifold(shape, Manifold)` and the BREP source is discarded. Use this when one feature needs an exact fillet inside an otherwise mesh-native model. No STEP export from this path.
- **Phase A — full `replicad`-language sessions.** Selected via `setActiveLanguage('replicad')` or the toolbar's BREP toggle. Code must `return` a `BrepShape` from `api.BREP.*`. The engine (`src/geometry/engines/replicad.ts`) tessellates the result for the viewport but *retains* the BREP shape in module-scoped `lastShape` so `partwright.exportSTEP()` (round-tripped through the Worker via the `exportSTEP` message) can serialize it.

### Lazy WASM loading

The user pays for a non-default engine only when they reach for it:

- **manifold-3d** — eager-loaded on app boot (the round-trip `Manifold.ofMesh` is needed for SCAD/BREP output, paint persistence, and slicing).
- **OpenSCAD** — `await import('openscad-wasm-prebuilt')` inside `openscadEngine.init()`. Triggered on first SCAD session open or first SCAD run in the Worker.
- **OpenCASCADE / replicad** — `await import('replicad')` + `await import('replicad-opencascadejs/...')` inside `ensureBrepLoaded()` in `src/geometry/brepRuntime.ts`. Triggered (a) in any manifold-js run whose code mentions `BREP`, or (b) on first replicad-language session run.
- **WebLLM** — `await import('@mlc-ai/web-llm')` inside `src/ai/local.ts`. Triggered on first local-model use.

Each loader is idempotent and caches the resolved module. Vite splits each one into its own chunk. See `docs/architecture-notes.md` for the `ensureXLoaded()` pattern when adding new lazy-loaded modules.

### Offline support (service worker)

The app works offline once it has loaded online once: a refresh with no network re-boots the editor instead of going blank, and modeling + the local WebLLM model keep working (cloud AI providers obviously don't). There's **one** service worker, `src/sw.ts`, built by **vite-plugin-pwa** (`injectManifest`) — it supersedes the old `coi-serviceworker.js`. It owns two jobs:

1. **Offline app shell** — `precache(self.__WB_MANIFEST)` caches the core build (the heavy lazy engines — OpenSCAD / replicad WASM — and the ~6 MB WebLLM worker are excluded via `globIgnores` and runtime-cached on first use instead). Navigations are network-first (online users always get the freshest build) with a cached-shell fallback; assets are precache-first via revision-aware `matchPrecache`.
2. **Cross-origin isolation** — COOP/COEP normally come from the server (Vite `server.headers` in dev, `public/_headers` in prod), but a cached *document* served offline needs them re-applied, so the worker re-stamps COOP/COEP on every navigation response. It's also the fallback for hosts that strip the headers (the old shim's role), via a one-time reload from `src/registerSW.ts`.

Key rules if you touch this:
- **Don't add a second service worker** — a page gets one controller per scope. Extend `src/sw.ts`.
- **`src/sw.ts` is excluded from the app `tsconfig`** (it uses WebWorker-lib globals); vite-plugin-pwa compiles it. The literal token `self.__WB_MANIFEST` must survive (don't alias it) or manifest injection fails.
- **Registration is production-only** (`src/registerSW.ts` gates on `import.meta.env.PROD`). The SW is intentionally **not** active in dev / the e2e suite (it would fight Vite's module pipeline), so dev relies on the server headers and the offline-caching path is verified against `npm run build` + `npm run preview` (whose `preview.headers` mirror prod isolation), not Playwright. The connectivity-aware UI (the offline pill in `src/ui/offlineIndicator.ts`, the AI panel's local-model nudge) *is* e2e-tested via `context.setOffline` in `tests/offline-mode.spec.ts`.
- Durable storage is requested via `requestPersistentStorage()` (`src/storage/persist.ts`) — on key save (`ai/db.ts`) and at boot when a key already exists — so IndexedDB + cached weights aren't evicted.

## Coordinate System

- **Right-handed, Z-up.** The XY plane is the ground, Z points up.
- Units are arbitrary (no physical unit assumed). Use consistent scale.

## Development Guidelines

### Planning Files

Write interstitial planning, design, and brainstorming documents to `.plans/` (gitignored). `docs/` is for **stable reference documentation that ships with the project** — both user-facing content (help page source, changelog) and developer/AI-agent reference docs (architecture notes, AI internals, test guides). Do **not** put ephemeral plan files or scratch notes in `docs/`.

### URL State

The app uses path-based routing for top-level pages and query parameters for view state within the editor.

**Paths:**
- `/` — Landing page (hero + recent sessions grid)
- `/editor` — Editor view (code + viewport)
- `/catalog` — Curated catalog of premade sessions
- `/ideas` — Ideas/showcase page: starter prompts, technique showcases, and interactive "use your own photo" flows. Backed by the `src/ideas/ideas.ts` dataset, which also powers the AI panel's 💡 prompt library + empty-state chips. Starter/technique tiles drop a prompt into the AI panel (populate, don't send — `prefillAiInput`); interactive tiles reuse the image→voxel and Relief import flows.
- `/help` — Help/docs page

**Query parameters** (on `/editor`):
- `?gallery` — Gallery tab
- `?diff` — Diff tab (side-by-side code + stat comparison between two versions)
- `?notes` — Notes tab
- `?session=<id>` — Active session
- `?session=<id>&v=3` — Specific version

Any `/editor` URL bypasses the landing page entirely. Tab switching is handled in `src/ui/layout.ts` (`switchTab`). Session/version state is handled in `src/storage/sessionManager.ts` (`updateURL`). Page-level routing is in `src/main.ts`.

### Browser History (Back Button) Preservation

`updateURL()` in `src/storage/sessionManager.ts` uses `history.replaceState`, not push — intentional for in-editor updates, but a trap for cross-page navigation. **Always push the destination history entry first**, then run any session-mutating call (`openSession`, `createSession`, `closeSession`, `importSessionPayload`). See `docs/architecture-notes.md` for the full pattern and the canonical examples in `src/main.ts`.

### Resource Lifecycle

Every resource you acquire must have a corresponding release:

- **Three.js**: When removing a `THREE.Mesh`, dispose both its `.geometry` and `.material` (handle `Array.isArray(mat)` for multi-materials). Failing to dispose materials leaks WebGL GPU memory.
- **Blob URLs**: Every `URL.createObjectURL()` must have a matching `URL.revokeObjectURL()`. The standard pattern is `img.addEventListener('load', () => URL.revokeObjectURL(img.src))`.
- **Event listeners on `document` or `window`**: If the component that added the listener can be destroyed/recreated, store a reference and call `removeEventListener` on teardown. Singleton components (created once, never destroyed) are exempt.

### URL State Consistency

Every URL parameter the app writes must also be read back correctly everywhere:

- If `switchTab()` in `layout.ts` writes a parameter (e.g., `?notes`), then `getViewState()` in `main.ts` must detect it. These two locations must stay in sync.
- `updateURL()` in `sessionManager.ts` must preserve tab parameters it doesn't own — don't delete query params managed by other modules.
- When adding a new tab or URL parameter, grep for all places that read or write URL state and update them all.

### IndexedDB Transactions

Always await `txn.oncomplete` before returning from functions that modify IndexedDB data. Awaiting individual request promises within a transaction is not sufficient — the transaction can still fail to commit after those promises resolve. Follow the pattern in `clearAllData()`.

**Never `await` between a `get` and the `put`/`delete` that depends on it inside one readwrite transaction.** Awaiting yields the microtask queue and lets IndexedDB auto-commit the (now request-less) transaction before the write is queued — a `TransactionInactiveError`, and across two tabs a lost update. Issue the dependent write from inside the `get`'s `onsuccess` callback (chain further requests from *their* callbacks too), then await `txn.oncomplete` once. See `recordUsage`, `updateSession`, and `putAttachment` for the pattern.

### Cross-Tab Isolation — No Data Bleed Between Windows

The app runs in multiple browser windows/tabs at once, often each driving a **different session** (and a different AI provider). Tabs share one origin, so they share IndexedDB *and* localStorage; separate windows do **not** share JS module memory. The rule:

> State must not bleed or cause side effects from one tab into another. The only times state should cross tabs are the **explicit** transitions: opening a session (incl. a previously-closed one) in a tab, or **taking control** of a session in another tab. Anything else changing in tab B must not silently alter tab A.

See `docs/architecture-notes.md` for the concrete implementation patterns (per-tab prefs, `storage`-event scoping, global-state rules).

### Numeric Constants and App Config

Never hardcode numeric tuning constants — timeouts, limits, thresholds, budgets, quality knobs — directly in source files. Instead:

1. **Add the constant to `src/config/appConfig.ts`** — pick the right section (`ai`, `renderer`, `import`, or `ui`), add a typed field to `AppConfig`, a default in `APP_CONFIG_DEFAULTS`, and a JSDoc comment explaining what it controls.
2. **Read it with `getConfig().<section>.<field>`** at the call site rather than storing it in a module-level `const`. This lets the user's saved override take effect immediately.
3. **Expose it in `src/ui/advancedSettingsModal.tsx`** — add a `<Field>` inside the matching `<Section>` with `label`, `hint`, `defaultValue`, `min`, `max`, and an `onChange` that calls `set(section, key, v)`.
4. **Worker context**: `getConfig()` in a Worker returns static defaults (no `localStorage`). If the value must be live for a Worker, thread it through the relevant message (e.g. `toolCallTimeoutMs` is passed via the `run_turn` message in `agentWorkerClient.ts`).

The only exceptions are values that are truly structural constants (array indices, enum values, magic bytes) rather than tunable knobs.

### Dead Code

Don't export functions unless they're imported elsewhere. When removing usage of an exported function, delete the export too. Periodically grep for exported symbols to verify they have importers.

### Internal Links and Paths

When referencing app routes in HTML/JS strings (links, prompts, instructions), use root-relative paths (`/ai.md`, `/editor`), not paths with a subdirectory prefix. The app is served from the root, and hardcoded path prefixes break both development and deployment.

### Duplicated Logic

When two functions share identical logic (same DOM manipulation, same data transformation), extract the shared part into a single helper and have both callers use it. Copy-pasted logic drifts out of sync when one copy gets updated and the other doesn't.

### Mobile-Friendly UI

The app targets both desktop and mobile. The `md:` breakpoint (768 px) separates the stacked-mobile layout from the side-by-side desktop layout. When adding interactive or layout features, keep these rules in mind:

- **Drag interactions**: Use the Pointer Events API (`pointerdown` / `pointermove` / `pointerup` + `setPointerCapture`) — it works identically for mouse, touch, and stylus. Never use mouse-only events (`mousedown`, `mousemove`) for draggable UI.
- **Touch targets**: Draggable handles and small buttons must have a hit area of at least 44 × 44 px on mobile. Use a visually narrow stripe (1–2 px) centered inside a wider/taller transparent wrapper element (`w-5`, `h-5`, etc.) so the visual stays subtle but the target is fingertip-friendly.
- **`touch-none`**: Add `touch-action: none` (Tailwind `touch-none`) to any draggable handle so the browser doesn't claim the gesture for scrolling before pointer-capture kicks in.
- **Layout overlays**: Fixed overlays (like the AI panel) that push desktop content via `padding-right` on `#app` should skip that adjustment on mobile (`window.matchMedia('(min-width: 768px)').matches`). Stacked mobile layouts don't have a side-by-side viewport to push.
- **Viewport-relative sizing**: Avoid hard-coded pixel widths for panel defaults that would exceed a phone screen. Test new panels/modals at 375 px wide.

### Commit & PR Conventions

**Before opening (or updating) a PR, re-sync your branch with the latest `origin/main`** — `git fetch origin main`, then merge it in (or rebase onto it) — so the PR diff reflects only your changes and merges cleanly without re-introducing already-merged work. See the Deployment workflow above for the full sequence.

PR titles, commit subjects, and PR labels feed the auto-generated release notes (`.github/release.yml`). Keep both consistent.

**Conventional Commits prefix** on commit subjects and PR titles:

- `feat:` — user-visible new capability
- `fix:` — bug fix
- `docs:` — docs/comments only (README, CLAUDE.md, ai.md, prompt logs)
- `refactor:` — internal restructure with no behavior change
- `chore:` — build, deps, tooling, CI config, label hygiene
- `test:` — test-only changes

Subject is imperative and lowercase after the prefix: `feat: add light/dark mode toggle`.

**PR labels** (drive release-note grouping — apply at least one before merging):

- `enhancement` — pairs with `feat:` → "Features" section
- `bug` — pairs with `fix:` → "Bug Fixes" section
- `documentation` — pairs with `docs:` → "Documentation" section
- `ignore-for-release` — suppress from release notes (use for `chore:`/`refactor:` housekeeping that shouldn't appear in user-facing notes)

Anything unlabeled lands in "Other Changes." That's fine for occasional internal cleanup, but features and fixes should always be labeled.

### Agent working discipline (git, PRs, tool output)

Guardrails for automated work, learned the hard way:

- **Irreversible GitHub actions stand alone, after an explicit decision.** Closing or merging a PR, deleting a branch, or force-pushing is outward-facing and hard to undo. Never batch such a call in the same tool block as other work (a sibling call fires even if the call meant to gate it errored or was never answered), and never infer the go-ahead — issue it as its own step only when the user explicitly asked for it. A PR close/merge is never a default or a guess. (A `PreToolUse` hook in `.claude/settings.json` also pauses for confirmation before `merge_pull_request` and a `state: closed` `update_pull_request`, as a backstop.)
- **A failed or unreadable tool result is not a success.** If a call errors (e.g. an `AskUserQuestion` that didn't validate) or its output comes back garbled / empty / out-of-order, re-run or re-verify state before proceeding — never act on an answer you didn't actually receive, and never treat a laggy/garbled shell as ground truth.
- **Git is single-writer.** The working tree and index are shared mutable state. Don't run git mutations while a subagent is also touching the same checkout. Resolve merges/rebases inline yourself; if you must delegate git work to a subagent, give it an isolated worktree (`isolation: "worktree"`).
- **Verify state between destructive git steps.** After a merge / rebase / reset, confirm `git status` and HEAD, and that local HEAD matches what you pushed, before moving on.

### After Opening a PR

Opening the draft is the start of the verification phase, not the finish line. The task is done when every PR-checks shard is green.

1. **Subscribe and watch CI.** Call `subscribe_pr_activity`. PR-checks runs build + unit + 3 e2e shards on every push, draft or ready — don't flip to ready to trigger it. Fix failures on the branch (each push re-runs the suite); fall back to local `npm run test:e2e` only when iterating tight on a CI failure.
2. **Launch a review subagent** (Agent tool) over the diff vs `origin/main`. Hunt for: defects and unhandled cases; functionality silently dropped in a merge; backwards-incompatible schema changes (old IndexedDB sessions and exported files must still load); security issues (XSS, leaked keys, weakened CSP/COEP/COOP). Surface findings as PR comments or fold clear fixes into the branch; raise ambiguous/large ones with the user.
3. **Auto-fix CI failures you're confident about.** Reproduce locally first. Re-sync `origin/main` if the branch has drifted, then push the fix. Ask the user for anything ambiguous, unrelated to your changes, or requiring a large refactor.
4. **Resolve merge conflicts when `main` advances.** Treat a stale/conflicting branch like a CI failure — actionable, not parkable. Fetch + merge `origin/main`, resolve conflicts by reconciling both sides (never drop recently-merged work to make your side apply cleanly), then prove it still works: `npm run build` + `npm run test:unit`, let CI re-run e2e, redo any manual verification the touched area warrants. Stop and ask if the conflict is large or lands in code you don't understand.
5. **Keep the PR description in sync** with the totality of what's on the branch — update Summary, Test plan, title/prefix/labels any time you push follow-up work.
6. **Mark ready, label, confirm green.** Once every shard and the Cloudflare preview are green and the review pass is clean: `update_pull_request` with `draft: false`, apply [release-note labels](#commit--pr-conventions).

## Common Errors

| Error | Cause |
|-------|-------|
| `Code must return a Manifold object. Did you forget to 'return'?` | Code didn't `return` anything, or returned undefined/null |
| `Manifold.cube is not a function` | Engine not initialized (WASM still loading) |
| `function _Cylinder called with N arguments, expected M` | Wrong number of arguments to a constructor |
| `Missing field: "x"` | Passed an array where an object was expected, or vice versa |
| Geometry renders but looks wrong | Check `isManifold` and `componentCount` in geometry-data — failed booleans often produce extra components |

## Examples

Located in `examples/*.{js,scad}`. Surfaced through the `/catalog` gallery (see `public/catalog/manifest.json`) and the command palette.
