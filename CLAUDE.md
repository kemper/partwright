# Partwright — AI-Driven Browser CAD Tool

## Quick Start

```bash
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/
npm run test:e2e     # Run Playwright smoke tests (auto-starts dev server)
```

Open `http://localhost:5173/editor?view=ai` to start with the 4 isometric views visible (instead of the interactive viewport). This is the recommended URL for AI agents — all views are visible on page load without clicking any tabs.

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
5. **AI agent bypass**: `http://localhost:5173/editor?view=ai` should skip the landing page and go straight to the editor with AI Views tab selected.
6. **Session loading**: Click a session tile on the landing page — should load the session code in the editor, show the session name in the session bar, and update the URL to `/editor?session=<id>`.
7. **Build**: `npm run build` should succeed with no TypeScript errors.
8. **Paint mode**: Click the Paint button in the viewport overlay. A color picker panel should appear. Click a face on the model — it should paint the coplanar region in the selected color. The Paint button badge should show the region count.
9. **Editor lock**: After painting a face, the editor should show a lock banner ("This version has color regions applied.") and become read-only. The run button should be disabled.
10. **Unlock modal**: Click "Unlock to edit" — a modal should appear with two options (preserve/destructive). Clicking "Unlock editor" with the default "preserve" option should save the colored version and create a new uncolored version. The editor should unlock.
11. **Gallery badges**: Colored versions in the gallery should show small color-swatch dots next to the version label.
12. **Color export**: With color regions painted, export GLB — the file should carry vertex colors. Export 3MF — the file should include `<basematerials>` and per-triangle `pid` attributes.
13. **Annotations are per-version**: Annotate v1, save v2 (annotations persist into v2). Clear annotations, draw a different one, save v3. Navigating v1↔v2↔v3 should swap annotations to match each version (v1 empty, v2 first set, v3 second set). Importing a schema-1.2 file (top-level `annotations`) should attach those annotations to the latest version on import.

## AI Agent Workflow & API Reference

For the full Manifold/CrossSection API, `window.partwright` console API, session workflow, verification patterns, and photo-to-model workflow, see `public/ai.md`. The legacy `window.mainifold` alias remains available for older prompts.

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
- `src/renderer/multiview.ts` — 4 isometric view grid (always visible)
- `src/editor/codeEditor.ts` — CodeMirror editor
- `src/ui/layout.ts` — Split-pane layout
- `src/ui/toolbar.ts` — Top toolbar
- `src/ui/panels.ts` — Views panel wiring
- `src/geometry/crossSection.ts` — Z-slice to SVG/polygons
- `src/export/gltf.ts` — GLB export
- `src/export/stl.ts` — STL export
- `src/export/obj.ts` — OBJ export
- `src/export/threemf.ts` — 3MF export (ZIP-packaged XML)

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
- `?view=ai` — AI Views tab
- `?view=elevations` — Elevations tab
- `?gallery` — Gallery tab
- `?diff` — Diff tab (side-by-side code + stat comparison between two versions)
- `?notes` — Notes tab
- `?session=<id>` — Active session
- `?session=<id>&v=3` — Specific version

AI agent URLs like `/editor?view=ai` bypass the landing page entirely. Tab switching is handled in `src/ui/layout.ts` (`switchTab`). Session/version state is handled in `src/storage/sessionManager.ts` (`updateURL`). Page-level routing is in `src/main.ts`.

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

When referencing app routes in HTML/JS strings (links, prompts, instructions), use root-relative paths (`/ai.md`, `/editor?view=ai`), not paths with a subdirectory prefix. The app is served from the root, and hardcoded path prefixes break both development and deployment.

### Duplicated Logic

When two functions share identical logic (same DOM manipulation, same data transformation), extract the shared part into a single helper and have both callers use it. Copy-pasted logic drifts out of sync when one copy gets updated and the other doesn't.

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
