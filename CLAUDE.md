# Partwright — AI-Driven Browser CAD Tool

## Quick Start

```bash
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/
npm run test:e2e     # Run Playwright smoke tests (auto-starts dev server)
```

Open `http://localhost:5173/editor` to go straight to the editor. AI agents drive the tool via the `window.partwright` console API and see geometry by calling the render tools (`renderViews`/`renderView`), so there is no special view to preselect.

Requires COEP/COOP headers (configured in vite.config.ts) for SharedArrayBuffer / WASM threads.

## Deployment

Hosted on **Cloudflare Pages** with production custom domain `www.partwrightstudio.com` and branch-based environments:

- **`staging`** branch → Cloudflare Pages preview deploy
- **`main`** branch → production deploy (protected, requires PR review)

**All work should be merged to `staging` first.** Do not push directly to `main`. The workflow is:

1. Create a feature branch, develop and test locally
2. Merge to `staging` — auto-deploys for verification
3. Once validated on staging, open a PR from `staging` → `main` for production release

- **Build command:** `npm run build`
- **Output directory:** `dist/`
- **SPA routing:** `public/_redirects` (`/* /index.html 200`)
- **Headers:** `public/_headers` (COEP, COOP, CSP) — Cloudflare Pages serves these automatically
- **Environment variable:** Set `SITE_URL` in Cloudflare Pages dashboard (Settings > Environment variables) to the production URL (`https://www.partwrightstudio.com`). This is used at build time by the `absoluteUrls` Vite plugin to make Open Graph image URLs and canonical links absolute. If `SITE_URL` is not set, the plugin falls back to `CF_PAGES_URL` (provided automatically by Cloudflare Pages for each deployment).

## Browser Tests (Playwright)

End-to-end smoke tests live in `tests/*.spec.ts` and run against a Vite dev
server that Playwright starts automatically. Run them with:

```bash
npm run test:e2e               # full suite
npx playwright test --grep "AI chat"   # one describe block
npx playwright test --headed   # watch the browser run (local only)
```

**Run these whenever you touch UI, routing, or anything in `src/ai/` or
`src/ui/ai*`** — the suite covers landing → editor → AI panel toggle →
key modal → toggle pills → ai.md serving in ~15s.

### Multi-environment browser detection

`playwright.config.ts` auto-picks the right Chromium binary so the same
test command works on a developer laptop and inside the Anthropic Claude
Code on the web sandbox without per-environment setup:

- **Sandbox** (`/opt/pw-browsers/` exists): config picks the highest
  installed `chromium-N` directory and uses its `chrome` binary directly
  via `launchOptions.executablePath`. The version pinned by the
  `playwright` npm package may differ from what's cached, but the
  installed browser still satisfies the test runner — no download
  needed (which is good, because the sandbox often blocks Chrome for
  Testing's CDN).
- **Local laptop** (no `/opt/pw-browsers/`): config leaves
  `executablePath` unset, and Playwright finds its own cache at
  `~/.cache/ms-playwright/` (Linux) or `~/Library/Caches/ms-playwright/`
  (macOS). Run `npx playwright install chromium` once on a new machine.

If the auto-detection picks the wrong binary, override it at the shell:

```bash
PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/path/to/chrome npm run test:e2e
```

### When AI agents need to run a browser test

1. Don't reinstall browsers blindly. Check `/opt/pw-browsers/` first; the
   sandbox image already has Chromium. `playwright.config.ts` handles the
   wiring.
2. The default Desktop Chrome viewport (1280×720) clips the AI panel's
   toggle strip. The config sets 1280×900 — keep it that way for
   anything that interacts with elements in the bottom half of the
   panel.
3. Tiny flex children of recently-transformed parents sometimes fail
   Playwright's viewport hit-test (`Element is outside of the viewport`).
   When the bounding box is verifiably inside, prefer
   `locator.dispatchEvent('click')` over `locator.click({ force: true })`
   — the latter still enforces the viewport bound.
4. Each Playwright test gets a fresh `BrowserContext`, so localStorage
   and IndexedDB are isolated by default. **Don't add `localStorage.clear()`
   in `beforeEach`** unless you mean it — it'll fire on `page.reload()`
   inside a test too, breaking any "state persists across reload"
   assertion.
5. Tests must run with no external network. The `validateKey` flow hits
   `api.anthropic.com`; assert on the surfaced error message, not on
   whether the request succeeded.

## Smoke Test — Verifying the App Works

After any changes that touch routing, Vite config, index.html, or initialization code, verify these things still work:

1. **Landing page**: Navigate to `http://localhost:5173/` — should show the hero section ("Partwright", "AI-driven parametric CAD in your browser"), CTA buttons, and a Recent Sessions grid (or empty state).
2. **Open Editor**: Click "Open Editor" on the landing page — URL should change to `/editor`, status should show "Ready" (green), the code editor should appear on the left with a default example, and a 3D model should render in the viewport on the right.
3. **WASM engine loads**: The status indicator (between editor header and tabs) should say "Ready" in green, NOT "Loading WASM..." or "WASM failed". If it shows "WASM failed", check:
   - `coi-serviceworker.js` loads without 404 (check Network tab)
   - `manifold.wasm` loads without 403 (check Network tab) — if 403, check `server.fs.strict` in vite.config.ts
   - COEP/COOP headers are present on responses (check Response Headers)
4. **Help page**: Click the `?` icon in the toolbar — should navigate to `/help` and show the help content. "Back" should return to the editor.
5. **AI agent bypass**: `http://localhost:5173/editor` should skip the landing page and go straight to the editor (Interactive tab). `window.partwright.renderViews({views:"box"})` returns a 6-face composite PNG data URL.
6. **Session loading**: Click a session tile on the landing page — should load the session code in the editor, show the session name in the session bar, and update the URL to `/editor?session=<id>`.
7. **Build**: `npm run build` should succeed with no TypeScript errors.
8. **Paint mode**: Click the Paint button in the viewport overlay. A color picker panel should appear. Click a face on the model — it should paint the coplanar region in the selected color. The Paint button badge should show the region count.
9. **Editor lock**: After painting a face, the editor should show a lock banner ("This version has color regions applied.") and become read-only. The run button should be disabled.
10. **Unlock modal**: Click "Unlock to edit" — a modal should appear with two options (preserve/destructive). Clicking "Unlock editor" with the default "preserve" option should save the colored version and create a new uncolored version. The editor should unlock.
11. **Gallery badges**: Colored versions in the gallery should show small color-swatch dots next to the version label.
12. **Color export**: With color regions painted, export GLB — the file should carry vertex colors. Export 3MF — the file should include `<basematerials>` and per-triangle `pid` attributes.
13. **Annotations are per-version**: Annotate v1, save v2 (annotations persist into v2). Clear annotations, draw a different one, save v3. Navigating v1↔v2↔v3 should swap annotations to match each version (v1 empty, v2 first set, v3 second set). Importing a schema-1.2 file (top-level `annotations`) should attach those annotations to the latest version on import.
14. **Local model picker**: Click the `✦ Connect AI` (or `✦ AI`) chip → in the modal, follow "Run a local model in your browser". A second modal lists Small / Medium / Large / Vision options with download sizes. The WebGPU banner shows green on Chrome/Edge/Safari 26+ and red elsewhere. The "Use this model" / "Download X GB" button only triggers a network request the first time; cached models show a "Downloaded" pill and skip straight to GPU load. Closing the tab during a download cancels it cleanly.
15. **STL import**: Click Import → "Choose file…" → pick an `.stl`. A new session is created named after the file, the editor shows a short `return Manifold.ofMesh(api.imports[0])` wrapper, and the mesh renders in the viewport. The version label is "imported" and editing the wrapper (e.g. adding `.subtract(Manifold.cube([5,5,5], true))`) re-renders correctly. Closing and reopening the session must restore the imported mesh from IndexedDB.

## AI Agent Workflow & API Reference

For the full Manifold/CrossSection API, `window.partwright` console API, session workflow, verification patterns, and photo-to-model workflow, see `public/ai.md`. The legacy `window.mainifold` alias remains available for older prompts.

### In-app AI chat — four providers

The right-side AI drawer can drive Partwright through any of:

- **Anthropic (cloud)** — user pastes their own API key (`src/ai/anthropic.ts`). Streams from Anthropic's hosted Claude with prompt caching on the long system prompt + tool list.
- **OpenAI (cloud)** — `src/ai/openai.ts`. Raw `fetch` against `/v1/chat/completions` with SSE streaming; no extra SDK.
- **Google Gemini (cloud)** — `src/ai/gemini.ts`. Raw `fetch` against `generativelanguage.googleapis.com` with SSE streaming via `:streamGenerateContent?alt=sse`; no extra SDK. The Gemini wire format wants `functionResponse.response` as a plain object — `toFunctionResponseObject` unwraps the JSON-stringified tool result before sending, otherwise Gemini silently drops the message and returns zero candidates on the next turn.
- **Local (WebGPU)** — runs a model entirely in the browser via [WebLLM](https://webllm.mlc.ai) (`src/ai/local.ts`). The user opts in from the AI settings modal and the weights download once into the browser cache. No API key, no network traffic per turn.

API keys live in IndexedDB (`aiKeys` store, keyed by provider). `ChatToggles` carries a separate model id per provider (`anthropicModel`, `openaiModel`, `geminiModel`, `localModel`) so switching providers preserves each one's previous selection — see `activeModel(toggles)` in `src/ai/types.ts`.

All providers share the same chat loop (`src/ai/chatLoop.ts`), the same tool schemas (`src/ai/tools.ts`), and the same `public/ai.md` system prompt (or its slim local variant) — only the request transport differs. `chatLoop` dispatches by `toggles.provider` via an if/else chain at the streamTurn call site. The WebLLM SDK is still loaded via dynamic `import()` so users who stick with hosted providers never pay the ~6 MB chunk download.

#### Thinking box (reasoning models)

Gemini 3 thinking models emit their reasoning as `thought:true` text parts (we opt in with `generationConfig.thinkingConfig.includeThoughts`). `gemini.ts` routes those to a separate channel (`StreamResult.thinking` + the `onThinking` stream callback) so they never bleed into the answer bubble. `chatLoop` persists the reasoning as a `'thinking'` `ChatBlock` (rendered above the answer); the panel shows a live indigo preview box while it streams (`renderLiveThinkingBox`), then collapses it into an expand/contract box (`renderThinkingBox`) once the next step — answer text or a tool call — begins. The `onThinking` delta beats the stall watchdog (via `onProgress({phase:'thinking'})`), so a long silent think doesn't trip a spurious abort. `'thinking'` blocks are display-only: no provider's request builder replays them as model text (re-feeding the prose wastes tokens).

#### Thinking level (the 🧠 pill)

`ChatToggles.thinking` (`off` | `low` | `medium` | `high`, default **off**) is a per-session knob in the toggle strip, sourced from `THINKING_LEVELS` in `types.ts`. Each provider maps it to its own wire format at request build time, so 'off' sends no thinking request at all and reproduces the pre-feature behavior:

- **Anthropic** — `low/medium/high` enable extended thinking with `budget_tokens` 2048/8192/16384 (`THINKING_BUDGET` in `anthropic.ts`), and `max_tokens` is floated above the budget (the API requires `>`). Because the agent is a tool-use loop, the API requires the signed `thinking` block to precede each `tool_use` on replay: `collectResult` captures the blocks (with `signature`, plus any `redacted_thinking`) into `ChatMessage.thinkingBlocks`, and `assistantBlocksToApi` re-emits them first — but only when thinking is on for the current request (`buildApiMessages(history, { replayThinking })`). Sending them with thinking off, or replaying display prose, is never done. This path can't be exercised offline (no network in tests/sandbox), so it's covered by request-shape unit tests rather than a live round-trip.
- **Gemini** — `off` only flips `includeThoughts:false` (deliberately NOT `thinkingBudget:0`, which some Pro models reject); `low/medium/high` set `includeThoughts:true` + a growing `thinkingBudget`. Note: this changed Gemini from always-on thinking to opt-in.
- **OpenAI** — maps to `reasoning_effort` (`low/medium/high`), sent only for reasoning models (`gpt-5*`, `o1/o3/o4` — sniffed by `isReasoningModel`) so the 4o/4.1 chat models don't 400. 'off' omits the param. OpenAI hides reasoning-model CoT, so this controls cost/quality but never surfaces a thinking box.
- **Local** — no effect (WebLLM models reason on their own; `<think>` is still stripped).

#### Cross-provider review

A "👁" button in the panel header opens `src/ui/aiReviewModal.ts`. The user picks a **different** provider/model than the one driving the chat, optionally types a focus prompt, and the reviewer is sent the current code + geometry stats + 4-iso snapshot + session notes via a single non-tool turn. The response lands as a `'review'` `ChatBlock` rendered with a distinct purple-bordered bubble in the transcript AND a `[REVIEW from <provider> / <model>] …` session note (so the primary agent picks it up on its next turn via `getSessionContext()`).

#### AI Call Log (per-provider diagnostics)

A "🩺" button in the panel header opens `src/ui/aiDiagnosticsModal.ts`. Shows the last 50 provider API calls from an in-memory ring buffer (`src/ai/diagnostics.ts`): provider/model/kind, duration, status, full error messages (errors auto-expand), token usage, stop reason, request summary. Filter (all/errors/successes), Clear, Copy JSON. This is distinct from the app-wide **Diagnostic Log** (`src/diagnostics/errorLog.ts`, toolbar ⚠ button) which captures uncaught errors/console warnings; the AI Call Log adds per-call detail (successes, tokens, the "empty_final" non-error case) the general log intentionally doesn't. To avoid double-listing, the AI Call Log mirrors to `console.info`/`console.debug` (not `warn`/`error`), and hard provider errors reach the app-wide log via `chatLoop`'s `onError → errorLog.capture({source:'ai'})`.

#### Adding a new hosted provider

1. Add the id to `Provider` in `src/ai/types.ts` and a `<name>Model` field to `ChatToggles` (+ default in `settings.ts`).
2. Add a sibling case to `activeModel(toggles)`.
3. Create `src/ai/<name>.ts` exporting `streamTurn`, `summarize`, `validateKey`, `resetClient` — same shape as `anthropic.ts`.
4. Register pricing in `src/ai/cost.ts`'s `PROVIDER_PRICING`.
5. Add a `<name>_MODEL_OPTIONS` array + `set<Name>Model` setter in `src/ai/settings.ts`.
6. Add dispatch + compaction branches in `chatLoop.ts` / `compaction.ts`.
7. Add a `buildHostedProviderSection(<name>, …)` call in `aiSettingsModal.ts`, a `PROVIDER_UI` entry in `aiKeyModal.ts`, and a `hostedConfig` entry in `aiPanel.ts`'s `renderModelPicker()`.

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

- `src/geometry/engine.ts` — manifold-3d WASM init + code execution
- `src/renderer/viewport.ts` — Three.js interactive viewport
- `src/renderer/multiview.ts` — Offscreen multi-angle render API (`renderViews`/`renderView`/`renderCompositeCanvas` for thumbnails)
- `src/editor/codeEditor.ts` — CodeMirror editor
- `src/ui/layout.ts` — Split-pane layout
- `src/ui/toolbar.ts` — Top toolbar
- `src/geometry/crossSection.ts` — Z-slice to SVG/polygons
- `src/export/gltf.ts` — GLB export
- `src/export/stl.ts` — STL export
- `src/export/obj.ts` — OBJ export
- `src/export/threemf.ts` — 3MF export (ZIP-packaged XML)
- `src/import/parsers/stl.ts` — STL import (binary + ASCII)
- `src/import/codegen.ts` — Generates `Manifold.ofMesh(api.imports[i])` wrapper code
- `src/import/importedMesh.ts` — Active-imports register exposed to the sandbox as `api.imports`

## Coordinate System

- **Right-handed, Z-up.** The XY plane is the ground, Z points up.
- Units are arbitrary (no physical unit assumed). Use consistent scale.

## Development Guidelines

### Planning Files

Write interstitial planning, design, and brainstorming documents to `.plans/` (gitignored). Do **not** write plan files to `docs/` — that directory is reserved for user-facing documentation that ships with the project.

### URL State

The app uses path-based routing for top-level pages and query parameters for view state within the editor.

**Paths:**
- `/` — Landing page (hero + recent sessions grid)
- `/editor` — Editor view (code + viewport)
- `/catalog` — Curated catalog of premade sessions
- `/help` — Help/docs page

**Query parameters** (on `/editor`):
- `?gallery` — Gallery tab
- `?diff` — Diff tab (side-by-side code + stat comparison between two versions)
- `?notes` — Notes tab
- `?session=<id>` — Active session
- `?session=<id>&v=3` — Specific version

Any `/editor` URL bypasses the landing page entirely. Tab switching is handled in `src/ui/layout.ts` (`switchTab`). Session/version state is handled in `src/storage/sessionManager.ts` (`updateURL`). Page-level routing is in `src/main.ts`.

### Browser History (Back Button) Preservation

`updateURL()` in `src/storage/sessionManager.ts` uses `history.replaceState`, not push. That is intentional for in-place updates within the editor (switching versions, naming a session) — those should not pollute the back stack. But it is a trap when navigating *into* the editor from another top-level page (`/`, `/catalog`, `/help`):

- If you call any session-mutating function (`openSession`, `createSession`, `closeSession`, or anything that calls `importSessionPayload`) BEFORE pushing the editor history entry, that internal `replaceState` will overwrite the page you came from and break the browser back button.
- **Always push the destination history entry first**, then run the state change. See `handleCatalogEntryLoad` and `openSessionFromLanding` in `src/main.ts` for the canonical ordering.
- For in-page "Back" buttons on top-level pages (catalog, help), prefer `window.history.back()` when there's a real previous entry on the stack — falling back to `replace` (not push) when the page was loaded directly by URL. See the `helpHasAppBackTarget` / `catalogHasAppBackTarget` patterns.

When adding a new top-level page or any cross-page navigation, walk through the flow before merging:

1. Where am I coming from? What's already on the back stack?
2. What does `window.location` look like after every async step (especially DB or session operations)?
3. After landing on the destination, does the browser back button take me to the prior page, not two pages back?

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

## Common Errors

| Error | Cause |
|-------|-------|
| `Code must return a Manifold object. Did you forget to 'return'?` | Code didn't `return` anything, or returned undefined/null |
| `Manifold.cube is not a function` | Engine not initialized (WASM still loading) |
| `function _Cylinder called with N arguments, expected M` | Wrong number of arguments to a constructor |
| `Missing field: "x"` | Passed an array where an object was expected, or vice versa |
| Geometry renders but looks wrong | Check `isManifold` and `componentCount` in geometry-data — failed booleans often produce extra components |

## Examples

Located in `examples/*.js`. Loaded via the toolbar dropdown.
