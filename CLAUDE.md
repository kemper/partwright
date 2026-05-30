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
3. **WASM engine loads**: The status indicator (small pill in the top-left of the viewport) should say "Ready" in green, NOT "Loading WASM..." or "WASM failed". If it shows "WASM failed", check:
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
15. **STL import**: Click Import → "Choose file…" → pick an `.stl`. With no session open, a new session is created named after the file. Whenever a session is open, an **import-target modal** appears first so the current part is never wiped without consent: choose **New part** (adds a separate part to the session), **Add to / Use for current part** (seeds an empty/starter part, or composes the mesh into the current part's geometry via `Manifold.compose` — works for both imported-mesh and hand-coded parts), or **New session**. A fresh `/editor` (still showing the starter) recommends "Use for current part"; a part with real work recommends "New part" and the part's unsaved code is saved first. In all cases the editor shows a short `return Manifold.ofMesh(api.imports[0])` wrapper (or a `Manifold.compose([...])` form when combined), the mesh renders, and the version label is "imported". Editing the wrapper (e.g. adding `.subtract(Manifold.cube([5,5,5], true))`) re-renders correctly. Closing and reopening the session must restore the imported mesh from IndexedDB.
16. **Merge parts**: In the Parts rail, check two or more parts (the multi-select checkboxes used for bulk delete). The bulk-action bar gains a **Merge N** button beside Delete. Clicking it opens a modal to either **combine into a new part** (keeps the originals) or **merge into one part** (replaces the selected parts with the combination). Each selected part's latest version is baked to geometry and composed — so it works for hand-coded parts, not just imported ones (the case that used to fail with "No geometry data") — producing a new "merged" version that holds the inputs as separate compose components. The current part's unsaved edits are saved first, so no manual Save is needed before merging.

## AI Agent Workflow & API Reference

For the full Manifold/CrossSection API, `window.partwright` console API, session workflow, verification patterns, and photo-to-model workflow, see `public/ai.md`. The legacy `window.mainifold` alias remains available for older prompts.

### In-app AI chat — four providers

The right-side AI drawer can drive Partwright through any of:

- **Anthropic (cloud)** — user pastes their own API key (`src/ai/anthropic.ts`). Streams from Anthropic's hosted Claude with prompt caching on the long system prompt + tool list.
- **OpenAI (cloud)** — `src/ai/openai.ts`. Raw `fetch` with SSE streaming; no extra SDK. The agent loop (`streamTurn`) routes **per model** (gated by `isReasoningModel`): reasoning models (gpt-5 family incl. gpt-5.5, o1/o3/o4) go to the **Responses API** (`/v1/responses`) because gpt-5.5+ reject `reasoning_effort` alongside function tools on `/v1/chat/completions` and direct callers to `/v1/responses`; every other / older model (gpt-4o, gpt-4.1, and legacy gpt-4 / gpt-3.5-turbo, some of which exist *only* on Chat Completions) stays on **Chat Completions** (`/v1/chat/completions`). The Responses path converts history to the `input` shape (`message`/`function_call`/`function_call_output` items linked by `call_id`); the Chat path uses the `messages`/`tool_calls`/`tool` shape. Both share the same dangling-tool-call repair, image handling, and review serialization. The non-tool, non-reasoning helpers (`validateKey`/`listModels`/`summarize`) always use `/v1/chat/completions` (works for every model).
- **Google Gemini (cloud)** — `src/ai/gemini.ts`. Raw `fetch` against `generativelanguage.googleapis.com` with SSE streaming via `:streamGenerateContent?alt=sse`; no extra SDK. The Gemini wire format wants `functionResponse.response` as a plain object — `toFunctionResponseObject` unwraps the JSON-stringified tool result before sending, otherwise Gemini silently drops the message and returns zero candidates on the next turn. **Thought signatures (Gemini 3+):** the model attaches an opaque `thoughtSignature` that must be echoed back on the next request *in the exact part it was received on* — a missing one on a `functionCall` part is a hard 400, and a missing one on a text part silently degrades reasoning (the model bails out early with a tiny `end_turn`, the "Gemini stalls after thinking" symptom). In streaming the signature can ride the `functionCall` part, the answer text part, **or a trailing part whose text is empty** — so `consumeGeminiStream` captures it off *any* part (`pendingSignature`) and binds it to the first tool call (mandatory) or the answer text block (`textThoughtSignature` → persisted on the text `ChatBlock`, replayed by `buildGeminiContents`). Skipping empty-text parts is the classic bug here.
- **Local (WebGPU)** — runs a model entirely in the browser via [WebLLM](https://webllm.mlc.ai) (`src/ai/local.ts`). The user opts in from the AI settings modal and the weights download once into the browser cache. No API key, no network traffic per turn.

API keys live in IndexedDB (`aiKeys` store, keyed by provider). `ChatToggles` carries a separate model id per provider (`anthropicModel`, `openaiModel`, `geminiModel`, `localModel`) so switching providers preserves each one's previous selection — see `activeModel(toggles)` in `src/ai/types.ts`.

All providers share the same chat loop (`src/ai/chatLoop.ts`), the same tool schemas (`src/ai/tools.ts`), and the same `public/ai.md` system prompt (or its slim local variant) — only the request transport differs. `chatLoop` dispatches by `toggles.provider` via an if/else chain at the streamTurn call site. The WebLLM SDK is still loaded via dynamic `import()` so users who stick with hosted providers never pay the ~6 MB chunk download.

#### Thinking box (reasoning models)

Gemini 3 thinking models emit their reasoning as `thought:true` text parts (we opt in with `generationConfig.thinkingConfig.includeThoughts`). `gemini.ts` routes those to a separate channel (`StreamResult.thinking` + the `onThinking` stream callback) so they never bleed into the answer bubble. `chatLoop` persists the reasoning as a `'thinking'` `ChatBlock` (rendered above the answer); the panel shows a live indigo preview box while it streams (`renderLiveThinkingBox`), then collapses it into an expand/contract box (`renderThinkingBox`) once the next step — answer text or a tool call — begins. The `onThinking` delta beats the stall watchdog (via `onProgress({phase:'thinking'})`), so a long silent think doesn't trip a spurious abort. `'thinking'` blocks are display-only: no provider's request builder replays them as model text (re-feeding the prose wastes tokens).

#### Thinking level (the 🧠 pill)

`ChatToggles.thinking` (`off` | `low` | `medium` | `high`, default **off**) is a per-session knob in the toggle strip, sourced from `THINKING_LEVELS` in `types.ts`. Each provider maps it to its own wire format at request build time, so 'off' sends no thinking request at all and reproduces the pre-feature behavior:

- **Anthropic** — `low/medium/high` enable extended thinking with `budget_tokens` 2048/8192/16384 (`THINKING_BUDGET` in `anthropic.ts`), and `max_tokens` is floated above the budget (the API requires `>`). Because the agent is a tool-use loop, the API requires the signed `thinking` block to precede each `tool_use` on replay: `collectResult` captures the blocks (with `signature`, plus any `redacted_thinking`) into `ChatMessage.thinkingBlocks`, and `assistantBlocksToApi` re-emits them first — but only when thinking is on for the current request (`buildApiMessages(history, { replayThinking })`). Sending them with thinking off, or replaying display prose, is never done. This path can't be exercised offline (no network in tests/sandbox), so it's covered by request-shape unit tests rather than a live round-trip.
- **Gemini** — `off` only flips `includeThoughts:false` (deliberately NOT `thinkingBudget:0`, which some Pro models reject); `low/medium/high` set `includeThoughts:true` + a growing `thinkingBudget`. Note: this changed Gemini from always-on thinking to opt-in.
- **OpenAI** — maps to the Responses `reasoning.effort` (`low/medium/high`), sent only for reasoning models (`gpt-5*`, `o1/o3/o4` — sniffed by `isReasoningModel`, which is also what routes them to the Responses endpoint). 'off' omits the `reasoning` field. Non-reasoning models go down the Chat Completions path, which never sends a reasoning request in either spelling, so they don't 400. OpenAI hides reasoning-model CoT, so this controls cost/quality but never surfaces a thinking box.
- **Local** — no effect (WebLLM models reason on their own; `<think>` is still stripped).

#### Auto-continue (the ♾ pill)

`ChatToggles.autoResume` (boolean, **on by default** in the standard/full presets — off in the lean minimal preset; per-session) makes the agent keep working until the model explicitly signals completion by calling the **`finish`** sentinel tool, instead of stopping at every `end_turn`. It's the antidote to models (notably Gemini) that end a turn early without finishing the task. The default lives in `DEFAULT_TOGGLES_BY_PRESET`; turning it off writes a `custom` preset that the `??`-based `mergeWithDefaults` preserves across reloads (an explicit `false` is never overwritten by the on-by-default). When **on**:

- `buildToolList` adds the `finish` tool (gated by `AUTORESUME_GATED` in `tools.ts`); `executeTool` short-circuits it to a sentinel ack (it never touches `window.partwright`). `toggleSuffix` appends an instruction telling the model to call `finish` only when truly done.
- In `chatLoop`, a turn that ends with `end_turn` (text **or** empty) **without** a `finish` call appends a synthetic user nudge (`AUTO_RESUME_PROMPT`, persisted with `ChatMessage.autoResumeNudge` → rendered as a subtle divider, not a blue bubble) and loops again. A turn that **does** call `finish` runs any remaining tools, then stops cleanly with reason `end_turn`.
- It's bounded by the existing **iteration cap** (the `for` loop) and **spend cap** (checked each iteration) — whichever trips first — so a model that never calls `finish` lands on the normal iteration-cap "Keep going" notice rather than looping forever. A queued human message takes priority over a `finish` stop (the loop delivers it instead of stopping).
- A no-progress ceiling (`MAX_CONSECUTIVE_AUTO_RESUMES` in `chatLoop.ts`) caps consecutive nudges that make no progress (no tool call), resetting on any tool call — so even under infinite iteration + spend caps a model that never calls `finish` can't loop forever. The auto-resume nudge also handles the `empty_final` case: an empty assistant turn gets a `(no response)` placeholder so it isn't dropped by the request builders (which would otherwise leave two consecutive `user` turns — a hard 400 on Anthropic). A human message queued mid-turn is delivered on the resume path in preference to the synthetic nudge.
- Turning it **off** is byte-for-byte the old behavior (no `finish` tool, no nudges, stop at each `end_turn`) and is remembered across reloads.

#### Cross-provider review

A "👁" button in the panel header opens `src/ui/aiReviewModal.ts`. The user picks a **different** provider/model than the one driving the chat, optionally types a focus prompt, and the reviewer is sent the current code + geometry stats + 4-iso snapshot + session notes via a single non-tool turn. The response lands as a `'review'` `ChatBlock` rendered with a distinct purple-bordered bubble in the transcript AND a `[REVIEW from <provider> / <model>] …` session note (so the primary agent picks it up on its next turn via `getSessionContext()`).

#### AI Call Log (per-provider diagnostics)

A "🩺" button in the panel header opens `src/ui/aiDiagnosticsModal.ts`. Shows the last 50 provider API calls from an in-memory ring buffer (`src/ai/diagnostics.ts`): provider/model/kind, duration, status, full error messages (errors auto-expand), token usage, stop reason, request summary. Filter (all/errors/successes), Clear, Copy JSON. This is distinct from the app-wide **Diagnostic Log** (`src/diagnostics/errorLog.ts`, toolbar ⚠ button) which captures uncaught errors/console warnings; the AI Call Log adds per-call detail (successes, tokens, the "empty_final" non-error case) the general log intentionally doesn't. To avoid double-listing, the AI Call Log mirrors to `console.info`/`console.debug` (not `warn`/`error`), and hard provider errors reach the app-wide log via `chatLoop`'s `onError → errorLog.capture({source:'ai'})`.

#### Adding a new hosted provider

1. Add the id to `Provider` in `src/ai/types.ts` and a `<name>Model` field to `ChatToggles` (+ default in `settings.ts`).
2. Add a sibling case to `activeModel(toggles)`.
3. Create `src/ai/<name>.ts` exporting `streamTurn`, `summarize`, `validateKey`, `resetClient` — same shape as `anthropic.ts`.
4. Wire pricing. Pricing is catalog-driven: add the provider's models.dev id to `CATALOG_PROVIDER_ID` in `src/ai/catalog.ts` (e.g. Gemini's `google`) so `getPricing()` resolves real rates from the build-time snapshot. For specific cheap models the snapshot doesn't carry (e.g. an older compaction model), add an explicit entry to `KNOWN_MODEL_PRICING` in `src/ai/cost.ts`; everything else falls back to `FALLBACK_PRICING` there.
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

Each loader is idempotent and caches the resolved module. Vite splits each one into its own chunk (verify by inspecting `npm run build` output — the OCCT WASM lands as `replicad_single-*.wasm` (~10 MB) outside the main bundle).

When adding a new lazy-loaded module, follow `brepRuntime.ts`'s pattern: one `ensureXLoaded()` promise that's cached after success and cleared on failure so the next call retries.

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

Opening the **draft** PR (see [the standing instruction](#pull-requests--open-a-draft-when-the-work-looks-good) above) isn't the finish line — it's the start of the verification phase. PR-checks runs the full suite — build + unit, then the 3 e2e shards — on every push, draft or ready, so the draft gets full signal immediately. The task is done when every shard is green; marking the PR ready for review (step 6 below) is the final step, a review-readiness signal rather than a CI trigger.

**1. Watch the full suite on the draft.** PR-checks runs build + unit **and** the 3 e2e shards on every push, draft included, so the draft gets full CI signal immediately — you don't flip to ready to trigger it. Subscribe to PR activity (`subscribe_pr_activity`) and watch the shards rather than running e2e locally up front. Run any deeper or manual verification the change warrants — e.g. exercising the affected UI in a browser per the [Smoke Test](#smoke-test--verifying-the-app-works) — alongside CI. Fall back to local `npm run test:e2e` only when iterating tight on a failure CI surfaced. Fix failures on the same branch (each push re-runs build + unit + e2e) until every shard goes green. Watching means watching mergeability too, not just the shards: if `main` advances and the branch goes out-of-date or conflicting, that's an actionable event — resolve it on the branch (step 4 below).

**2. Kick off an automated review pass.** Right after pushing the draft, launch a review subagent (the Agent tool) over your branch diff against `origin/main` and the code it touches. Have it hunt specifically for problems your change may have introduced:

- **Defects** — logic errors, unhandled cases, broken or orphaned call sites in the new code.
- **Functionality dropped in a merge** — features or code paths silently lost while resolving conflicts or re-syncing with `origin/main`. Diff against what was there before, not just your own edits.
- **Backwards-incompatible changes** — anything that breaks existing persisted data or files. Watch session/schema changes most closely: old sessions saved in IndexedDB, and previously exported files (GLB/3MF and any versioned schema), must still import and load. A schema bump needs a migration or back-compat read path, not a hard break.
- **Security issues** — injection (command/SQL), XSS or unsafe HTML insertion, leaked API keys/secrets, or weakened CSP/COEP/COOP headers.

Surface the results on the PR (a review comment, or fold clear fixes straight into the branch). If the pass turns up something ambiguous or large, raise it with the user rather than silently reworking.

**3. Follow CI and auto-fix what you can.** Watch the PR's checks — the **PR-checks** workflow (build + unit, then the 3 sharded e2e jobs) and the Cloudflare Pages preview deployment — and **auto-fix failures when you can** by pushing a fix straight to the PR branch.

1. Reproduce the failure locally first (`npm run build`, `npm run test:unit`, `npm run test:e2e`) so you're fixing the real cause, not guessing from the log.
2. Re-sync with the latest `origin/main` if the branch has drifted (see the Deployment workflow), then commit and push the fix to the same PR branch.
3. Re-check CI after the push, and keep iterating until the checks are green.

Only push fixes you're confident in — failures clearly caused by your own changes. If a failure is ambiguous, unrelated to your changes, or would require a large refactor or a risky/destructive change to resolve, stop and ask the user instead of pushing speculative fixes.

**4. Resolve merge conflicts when the base branch moves under the PR.** When you're watching a PR and `main` advances — the branch falls behind, or GitHub reports it no longer mergeable — treat that like a CI failure: an actionable event to fix on the branch, not something to park for a human. Bring it up to date: `git fetch origin main`, merge `origin/main` into the branch (or rebase onto it), resolve the conflicts, and push to the same PR branch.

But the bar is an **integrated, working result — not just a clean merge.** A conflict is two intentions colliding, and clearing the markers is the easy part. Before you push:

1. **Understand and respect the work you're merging in.** Read what actually landed on `main` since the branch diverged — the conflicting commits and the PRs/notes behind them — and reconcile your change *with* it. Keep both sides unless one genuinely supersedes the other; never drop someone else's recently merged work just to make your own side apply cleanly. (This is the clobbering trap the re-sync rule above warns about.)
2. **Then prove it still works.** A resolution that compiles is not a resolution that's correct. Re-run `npm run build` + `npm run test:unit`, let PR-checks re-run the e2e shards on the push, and redo any manual/render verification the touched area warrants — per the automated review pass (step 2 above; watch for functionality silently dropped in the merge) and the [Smoke Test](#smoke-test--verifying-the-app-works). Treat the merged result as new code to verify, because it is.

If the conflict is large, lands in code you don't understand, or resolving it would mean materially changing recently-merged behavior, **stop and ask** (`AskUserQuestion`) rather than push a speculative resolution — same bar as the CI auto-fix rule above.

**5. Keep the PR description in sync with the branch.** Any time you push new work to an open PR — review fixes, CI fixes, or follow-up commits that go beyond the PR's original scope — re-check the PR description and update it to cover the *totality* of the work now on the branch, not just what existed when the PR was first opened. Fold the new changes into the Summary, refresh the Test plan, and bring the title, prefix, and labels back in line with the [commit & PR conventions](#commit--pr-conventions) if the scope has grown. The description and the branch diff should never tell different stories — don't let the description silently drift behind the work.

**6. Mark ready for review, label, and confirm green.** Once every PR-checks shard plus the Cloudflare Pages preview are green and the automated review pass is clean, mark the PR ready for review (`update_pull_request` with `draft: false`) and apply the [release-note labels](#commit--pr-conventions). Marking ready is a review-readiness signal — CI already ran on the draft, so it doesn't re-trigger the suite. The task is done once CI is green. If verification surfaced something ambiguous or large, keep the PR in draft and raise it with the user instead of pushing speculative fixes.

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
