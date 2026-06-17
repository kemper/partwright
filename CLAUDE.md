# Partwright — AI-Driven Browser CAD Tool

## Quick Start

```bash
npm run dev          # Start dev server at http://localhost:5173
npm run build        # Production build to dist/ (runs tsc first — also the type-check)
npm run typecheck    # tsc --noEmit only — fast type check without the Vite production build
npm run preflight    # typecheck + test:unit + lint:deps + lint:consistency in one command (the pre-push bundle)
npm run test:unit    # Fast vitest unit tier (pure-logic, no browser) — ~1s
npm run test:e2e     # Playwright browser suite (auto-starts dev server)
npm test             # Both tiers: unit, then e2e
npm run lint:consistency  # ast-grep UI-convention scan (advisory)
npm run lint:deadcode     # knip: dead deps/imports (gate) + unused exports (advisory)
npm run lint:deps         # madge: circular dependencies (gate — graph is acyclic)
npm run model:preview -- <file.js>   # headless model stats + 4-view PNG (Node+WASM, ~2s) — see below
npm run snap -- /editor [--out f.png] [--wait ms]  # one-shot navigate→settle→screenshot, no spec needed — see Manual Verification
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
3. **Release is manual:** once you've validated the staging preview, open a PR from **`staging` → `production`** and merge it. Cloudflare deploys `production` to `www.partwrightstudio.com`. The release PR must be a **pure promotion** — it carries only commits already on `main` (see the superset rule below); any changelog/release-note edits go through `main` *first*, never onto the release branch.

> **Feature work now targets `main`, not `staging`.** `staging` is written only by the gate Action — never push to it or open a PR into it directly. `production` is written only by the manual release PR.

> **`main` is the superset — `staging` and `production` must never hold content `main` lacks.** The pipeline is strictly one-directional: every change reaches `staging`/`production` only *after* it lands on `main`. `staging` is just `main` fast-forwarded by the gate, so it can't drift. The one drift vector is the **manual release PR into `production`**: a release PR must be a **pure promotion** of gated `staging` — it must introduce **zero** content that isn't already on `main`. **Never commit changelog, release-note, help, or any other edits onto the release branch.** Release notes are normal product changes: write them on a feature branch into `main` first (`docs:` PR), let the gate advance `staging`, *then* cut the release from `staging`. The `production-promotion-guard` Action (`.github/workflows/production-promotion-guard.yml`) fails any production PR that carries content beyond `main` — if it trips, you've put release-time edits in the wrong place. (This is the rule that the May 2026 changelog/help drift violated: release-note commits added straight onto release branches never flowed back to `main`, so a later `main`-side refactor silently clobbered them.)

**Release versioning — `package.json` `version` is the single source of truth.** Releases are semantically versioned (`vX.Y.Z`) and **every production release is git-tagged automatically.** The `Tag release on production` Action (`.github/workflows/release-tag.yml`) fires on each push to `production` (i.e. each promotion merge), reads `package.json`'s `version`, and — if no tag for that version exists yet — creates the annotated `vX.Y.Z` tag and a GitHub Release with auto-generated notes (grouped per `.github/release.yml`). It's idempotent: a production push that didn't change the version no-ops.

> **Bump the version through the pipeline, never on the release branch.** To cut a release, bump `package.json` on a *feature branch into `main`* — the bump level encodes the change's blast radius and follows the same semantics that drive the (planned) versioned-deployment strategy:
> - **major** (`1.0.0` → `2.0.0`, commit `feat!:`) — a breaking change: code or sessions authored against the old version may not work, so it requires a conscious user migration to a new top-level deployment.
> - **minor** (`feat:`) / **patch** (`fix:`) — backward-compatible; rolls forward in place on the latest deployment of the current major.
>
> The bump flows main → gate → staging → the promotion PR → production exactly like any other change, so it never violates the pure-promotion rule. The running version is surfaced in the in-app **About** dialog (`src/buildInfo.ts` `version`, from `package.json` at build time). The first tagged release is `v1.0.0`. *(Planned next: stamp this `X.Y.Z` into the session schema + exported files as the "last known-good" version, and segment IndexedDB by major for the versioned-deployment migration flow.)*

Feature work follows a **draft-PR-first** flow: open the PR as a draft the moment the implementation looks good, and PR-checks runs the full suite — build + unit *and* the e2e shards — on every push, draft or ready. Marking the PR ready for review is a review-readiness signal, not a CI trigger; your task is done once every PR-checks shard goes green. The full sequence:

1. **Start from the latest `main`.** Before writing any code, run `git fetch origin main` and base your feature branch on `origin/main`. Do this at the *start* of the task, not just before the final push.
2. **Implement, then manually verify in the browser.** Once the change looks right, exercise the feature in a real browser by writing and running a short Playwright spec that navigates to it, interacts, and writes a screenshot file — then view the PNG and post it in the chat so the user can see it working. (There is **no** Playwright MCP in this environment; the spec-driven screenshot *is* the manual check.) See [Manual Verification](#manual-verification--checking-your-work-in-the-browser) for the full pattern and the scope by change type. You don't need the full automated e2e suite at this stage; CI runs it on the draft. But do run a targeted spec if one exists for the area you changed: `npx playwright test --grep "describe block"` (~30 s for one spec) catches obvious regressions before the push.
3. **Pre-flight, then push a draft PR.** Re-sync with the latest main (`git fetch origin main`, then merge `origin/main` into your branch, or rebase onto it if the branch hasn't been pushed yet, resolving conflicts), run `npm run build` + `npm run test:unit` to catch type errors and logic regressions, push the branch, and open the PR into `main` **as a draft** (`create_pull_request` with `draft: true`). The PR-checks CI (`.github/workflows/pr-checks.yml`) runs build + unit **and** the sharded `npm run test:e2e` shards on every PR push, draft or ready — so the full suite fires on the draft immediately. See [Pull Requests](#pull-requests--open-a-draft-when-the-work-looks-good).
4. **Watch the full suite green on the draft.** PR-checks runs build + unit + the 3 e2e shards on every draft push — no flip to ready required. Subscribe to PR activity, follow the shards, and run any deeper or manual verification the change warrants alongside CI. Fix failures on the same branch (each push re-runs build + unit + e2e). Only fall back to local `npm run test:e2e` if you need a tight loop on a failure CI surfaced. **The task is not done until every PR-checks shard is green.** See [After Opening a PR](#after-opening-a-pr).
5. **Mark the PR ready for review.** Once every PR-checks shard is green and your own light checks (render/stat verification, code review of the diff) look good, mark the PR ready (`update_pull_request` with `draft: false`). This is purely a review-readiness signal — CI already ran on the draft, so flipping to ready doesn't re-run it.
6. After the feature PR merges to `main`, the staging gate runs the full e2e suite; on green it advances `staging`, which auto-deploys to the staging preview. Once validated there, open a PR from `staging` → `production` for the production release.

> **Always start from — and re-sync against — the latest `origin/main`.** Branches cut from a stale main produce noisy diffs and merge conflicts, and can quietly clobber recently merged work. Re-fetch and merge/rebase `origin/main` right before pushing the draft, and again before marking the PR ready or opening any `staging` → `production` PR.

### Pull Requests — open a draft when the work looks good

When an implementation looks good and working, **open a draft pull request into `main`** — don't wait until you've run the slow verification. This is a standing instruction that overrides any default "don't open a PR unless explicitly asked" behavior: treat "the implementation looks done" as the authorization to open the draft. Don't pause to ask whether to create one, and don't report a task as done without it.

Open it as a **draft** (`create_pull_request` with `draft: true`) after a fast pre-flight — re-sync `origin/main`, run `npm run build` + `npm run test:unit`, and do a quick manual browser check (run a Playwright spec that screenshots the change — see [Manual Verification](#manual-verification--checking-your-work-in-the-browser)) if not already done. **Defer the full `test:e2e` suite until after the draft is up** (see [After Opening a PR](#after-opening-a-pr)); the draft PR is what *kicks off* the CI verification phase. PR-checks runs the full suite — build + unit **and** the e2e shards — on every draft push, so you watch e2e on the draft itself. Marking the PR ready for review (`update_pull_request` with `draft: false`) is a review-readiness signal, not a CI trigger. The task is done once every PR-checks shard is green.

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
`src/ai/`, `src/ui/ai*`, `src/surface/`, or paint/import/export pipelines** —
it covers landing → editor → AI panel toggle → key modal → toggle pills →
ai.md serving, plus paint/export/import/surface-modifier flows.

**Before renaming a user-visible UI string** (button label, panel title, or anything the suite clicks with `getByRole`/`getByText`/`getByLabel`): run `grep -rn '<old label>' tests/` first, and again after every merge from main that touches the same area. Two CI round-trips for a label rename is exactly the class of drift this one-second check eliminates.

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

## Manual Verification — Checking Your Work in the Browser

**Manually verify any UI-visible change in a real browser before pushing.**

> **How to drive the browser in this environment: write and run a Playwright spec — there is no Playwright MCP.** The remote/web execution environment only configures the `serena` MCP server (see `.mcp.json`); the `playwright_navigate` / `playwright_click` / `playwright_screenshot` tools do **not** exist here. Don't waste turns calling them. The real eyes-on check is a short `.spec.ts` that navigates, interacts, and writes a screenshot file you then view.

The pattern:

1. **Install deps once per container:** a fresh remote container starts with no `node_modules` — run `npm ci` before your first `npx playwright test` (you'll get `Cannot find package 'playwright'` otherwise).
2. **For a look-only check, skip the spec: `npm run snap -- <route>`.** When all you need is "load this route and show me" (no clicks/typing), `npm run snap -- "/editor?session=x" --out test-results/x.png [--wait ms] [--width N --height N] [--full]` generates and runs the throwaway spec for you — it waits for the editor engine on `/editor` routes, screenshots, and cleans up after itself. Anything that needs interaction still wants a real spec (next step).
3. **Write a spec that screenshots the feature.** It can be a throwaway probe (`tests/_scratch-*.spec.ts`, delete it after) or — better, for a new feature — the permanent golden-path spec you'd add anyway. Navigate, exercise the change, and capture the result:

   ```ts
   import { test } from 'playwright/test';

   test('scratch: my feature renders', async ({ page }) => {
     await page.goto('/editor');
     await page.waitForTimeout(4000);            // let WASM + viewport settle
     // ...click/type to exercise the change...
     await page.screenshot({ path: 'test-results/my-feature.png' });
   });
   ```

4. **Run it:** `npx playwright test _scratch-` (or the spec name). You do **not** need to start the dev server yourself — `playwright.config.ts`'s `webServer` block boots `npm run dev` automatically and reuses an already-running one, and the config auto-detects the sandbox Chromium under `/opt/pw-browsers/`.
5. **View the screenshot and post it in the chat** — `Read` the PNG to see it inline, then `SendUserFile` to surface it to the user. This is the most valuable thing you can do: the user is watching the session and wants to see the feature working (or not) at each meaningful step — opened panel, rendered output, before/after comparison, edge case.

This takes a handful of tool calls and catches wiring mistakes, visual regressions, and WASM timing issues that TypeScript can't see. It's your own eyes-on check before CI runs the headless suite. If you used a throwaway `_scratch-*.spec.ts`, delete it (and its `test-results/*.png`) before pushing.

**Scope by change type:**

| Changed area | Required verification |
|---|---|
| Routing, Vite config, `index.html`, init | Run `/smoke-test` (16-item checklist) |
| New UI feature or changed visible behavior | Navigate to it, exercise golden path, screenshot |
| AI panel / provider changes | Open panel, verify connection indicator, basic interaction |
| Surface modifiers (fuzzy/smooth/voxelize/scale) | Trigger the modifier, verify the result renders correctly |
| Paint, import, export | Trigger the specific flow, verify output |
| Pure logic, no UI | Unit tests sufficient; Playwright not required |

**When to add a Playwright spec:** When you land a new UI feature, add a `tests/*.spec.ts` that covers its golden path. Not exhaustive coverage — one `test()` that opens the feature, performs the core interaction, and asserts the key visible outcome is enough to catch future regressions.

## Headless Model Preview — `model:preview` (for CLI agents authoring geometry)

When you're iterating on a **model snippet** (catalog entries, `examples/`, mechanism prototypes) from the CLI, don't round-trip through the browser for every guess. `npm run model:preview -- <file.js>` runs the snippet against the **real `manifold-js`, `voxel`, or `scad` engine in Node** (via vite SSR — no dev server, no Playwright, ~2 s). **`replicad`/BREP is excluded**: OpenCASCADE won't init under Node SSR — verify BREP-language models in the browser. The tool gives you everything needed to self-correct in one call:

```bash
npm run model:preview -- .plans/fidgets/spiral-cone.js          # writes <file>.preview-<stamp>.png + prints JSON
npm run model:preview -- model.js --json                        # stats only, no PNG
npm run model:preview -- model.js --png out.png -p turns=6      # override api.params (only binds when snippet declares a paramsSchema)
npm run model:preview -- model.js --view 130,35                 # ONE custom-angle tile (peek behind a feature)
npm run model:preview -- model.js --view "130,35;0,-72;90,7"    # SEVERAL custom angles in one call (';'-separated az,el) — tiled
npm run model:preview -- model.js --views front,iso,back        # pick/reorder named views (front,back,right,left,top,bottom,iso)
```

- **JSON stat block** (stdout): `isManifold`, `componentCount`, per-component `{volume, bbox, triangleCount, center}`, `volume`, `surfaceArea`, `genus`, `bbox`, `aspectRatio`, `minEdgeLength`/`meanEdgeLength`, model-declared `labels` (every declared label as `{name, color, triangleCount}` — colored AND uncolored; a **0 triangleCount = a buried/aliased label that paints nothing**), `paramsSchema`, and a `warnings[]` array (fused parts, **interpenetrating components / clearance**, **0-triangle labels**, tri-count over the ~500k catalog budget, sub-0.4 mm detail, …).
- **4-view PNG** (front / right / top / iso by default; override with `--view`/`--views`), shaded by face normal with the model's own label colors — enough to judge proportions, spirals, and color at a glance. `Read` it like a thumbnail. Use `--view az,el` to rotate to an occluded feature when the four default angles hide it — or pass **several `;`-separated pairs** (`--view "az,el;az,el;…"`) to get **multiple custom angles tiled in one call** (e.g. iso + underside + side together). The default PNG path is **stamped unique per run** (old stamps for the same model are cleaned up) so the Read tool's per-path image cache can never serve a stale render — take the path from the JSON's `png` field.
- **Paint-in-code is verified headlessly.** `api.paint.*` ops (box/slab/cylinder/label) resolve against the mesh with the same pure helpers the browser uses: the PNG shows the colours and `stats.paintOps` lists per-op `{name, kind, triangleCount}` — an op that resolves to **0 triangles warns** (region misses the surface / label doesn't exist). Brush-painted sidecar regions still need the browser.
- **Voxel `v.sdf` extras:** `voxelRes` (world-units-per-voxel, when all `v.sdf` calls agree), `worldBBox` (bbox × res — the authored world size, no mental ×res), and `sdfLabelCounts` (fills per `colors` label, **including 0** — a zero-fill label warns, surfacing the smoothUnion deepest-region trap instead of silently coloring nothing).
- Implementation: `scripts/model-preview.mjs` (CLI + pure-JS rasterizer → `sharp`) + `src/tools/previewModel.ts` (the faithful engine call). No WebGL needed.

> **Verify from the angle where a defect would hide — including the underside — not just the default iso/front.** The default 4-view (front/right/top/iso) can completely hide a problem on the bottom of a model (a sole clipping through a base, a foot poking through a pedestal underside, a hollow that only opens downward). When you've changed anything near the ground/underside, **add `--view az,el` with a negative elevation to look UP at the bottom** (e.g. `--view 0,-72`), or capture several angles at once with `--view "az,el;az,el;…"` (e.g. `--view "-50,28;0,-72;90,7"` for iso + underside + side). And when a user reports a defect, **reproduce their exact camera angle first** — fixing what you can't see from your chosen angle is how a "fixed" bug ships unfixed twice.
>
> **Inspect at HIGH RESOLUTION for quality control — small renders hide real defects.** `model:preview` now defaults to `--size 768`, but that is still too small to judge fine features. When scrutinising faces, eyes, lettering, seams, or paint, render a single tight `--view` at **`--size 1200`+** and actively hunt for defects: jagged or rectangular openings, interpenetrations, sliver gaps, faceting, and **paint/colour bleed** (one label's colour spilling onto an adjacent surface). **Crop the PNG natively** (`sharp(...).extract(...)` on the high-res render) to zoom — never upscale a small crop, which only blurs and re-hides the defect. A bug invisible at the default tile size (a jagged box-cut eye opening shipped twice this way) is obvious at 1200px. Treat "looks fine in the thumbnail" as unverified until you've looked at the feature up close.
>
> **`model:preview` shades by face normal — it does NOT show `api.label`/palette colors** (in-code `api.paint.*` ops DO resolve and show). To confirm color correctness (e.g. "is this the boot or the skin showing?"), you must render the **colored** catalog bake: `xvfb-run -a node scripts/build-catalog-entry.cjs --source <file> --lang manifold-js --out /tmp/x.partwright.json --palette-file <palette>` writes `/tmp/x.thumb.png`; point its camera with `THUMB_AZIMUTH`/`THUMB_ELEVATION` (negative elevation = from below). A shaded-normal preview that "looks solid" can still be a different label's surface.
>
> **Measure geometry empirically when `smoothUnion` is involved — don't trust analytic primitive extents.** A `smoothUnion` bulges the surface *past* either input primitive's bounds (a foot's real underside sat ~0.79·r below the sole centre vs the analytic 0.65·r), and `bounds()` is loose. To find a true surface position, walk `evaluate(x,y,z)` along the axis in a tiny vite-node script (`npx vite-node probe.mjs` importing `__figureTestables__` + `__testables__`) until the sign flips. Set clearances/clip planes below the *measured* value, then confirm coverage with a sample-grid check (sample where one label is solid; assert the covering label is solid there too).
>
> **For SUBJECTIVE / aesthetic work, prototype options and get the user's pick BEFORE wiring it into a builder.** When the deliverable is *how something looks* (a shoe/sole, a face, a silhouette, a colour scheme) — not a measurable spec — don't implement one interpretation and iterate it through full implement→bake→review cycles; that's the slowest path and it burns the user's patience. Instead build **2–3 throwaway variations**, render them **from ≥4 angles (incl. the underside) in colour**, show the user a side-by-side (e.g. `bin/partwright.mjs compare`, or `--view "az,el;az,el;…"` / colored bakes montaged with `sharp`), and let them choose the direction. One comparison round beats five blind iterations. (This is the lesson from the footwear sole: several rounds shipped "fixed" before a quick demo-and-pick converged it.)

**`componentCount` is the instrument for print-in-place mechanisms.** A model that returns separate moving parts (screw, spinner, hinge, captive ball, two-tone spiral) must report `componentCount === N`. If it fuses to `1`, the clearance gap is too small or parts collide. The reliable recipe for splitting one solid into interleaved colored parts: subtract a clearance-thick cutter (e.g. a full-diameter helical **slab** for a spiral), then `manifold.decompose()` and color each component. Verify topological/geometric claims with `model:preview`, not from memory.

**When `componentCount` is wrong: decompose and inspect, don't tune blindly.** Call `Manifold.decompose()` on the result, iterate the parts, and check which one floated or fused — a 10-line diagnostic snippet beats 3 rounds of parameter-tweaking on the whole assembly. Note that many legitimate catalog subjects (assemblies, orreries, watch movements) intentionally have `componentCount > 1`; `isManifold: true` is the correctness gate, not the count. Pass `{ maxComponents: N }` to `runAndSave` when the model is intentionally multi-part.

> **Voxel models: trust `voxelPieceCount`, not `componentCount`, for "is this one printable piece?"** `componentCount` comes from the meshed solid and over-reports voxel grids — an enclosed cavity counts as a second component, and voxels touching only at an edge/corner split apart. The stats also carry `voxelPieceCount`, a face-connected (6-neighbour) BFS over the grid that matches what actually fuses on an FDM plate. A one-piece hollow voxel shell reports `componentCount: 2` but `voxelPieceCount: 1`.

`model:preview` can do that island inspection for you:

```bash
npm run model:preview -- model.js --explain-components   # per-island vol/tris/size/center (to stderr)
npm run model:preview -- model.js --expect-components 3   # assert; exits non-zero on mismatch (CI gate)
node bin/partwright.mjs compare a.js b.js c.js --png out.png        # tile each model's iso view into one contact sheet
node bin/partwright.mjs compare a.js b.js --view 130,35 --png o.png # …from a custom angle
node bin/partwright.mjs fetch <image-url> --out ref.png            # pull a remote image to disk (then `photo` it)
```

`--explain-components` prints the per-island breakdown (already in the JSON's `stats.components`, capped at the top 16 by volume) to stderr so the stdout JSON stays parseable. `--expect-components N` compares against the uncapped `stats.componentCount` and exits 1 on mismatch — the escape hatch for "this mechanism MUST stay N parts." `compare` runs several variants and lays one view of each side-by-side (default iso, `--view az,el` to change it), for A/B param sweeps or before/after checks. `fetch` downloads a remote image to disk so the `photo` voxel-import flow can consume a URL (the env's network policy governs reachability).

> **Paint-label QC headlessly — `figure:smoke` / `--require-labels` (catches buried eyes WITHOUT the ~75s xvfb bake).** `model:preview` shades by face normal and `stats.labels` now lists **every** declared label with its **paintable-triangle count** — including uncolored ones (figure eyes/iris/pupil are labelled geometry whose colour is applied at bake time, so they used to be invisible here). **A label at 0 triangles is a buried/aliased-away feature that will bake as nothing** — the exact trap that shipped eyeless figures, previously only catchable by the slow colored bake. Two ways to gate it in ~2s:
>
> ```bash
> npm run figure:smoke -- figure.js                          # paint-QC report: per-label tri counts, 0-tri flags, manifold/components/genus
> npm run figure:smoke -- figure.js --require-labels eyes,iris,pupil   # exit 1 if any listed label paints 0 triangles
> npm run model:preview -- figure.js --require-labels eyes,iris,pupil  # same gate on the full preview (also writes the PNG)
> ```
>
> `--require-labels` is the headless twin of `scripts/build-catalog-entry.cjs --require-labels`, so you catch buried-feature paint failures in the fast loop instead of at bake time. **Pass only the labels THIS figure must show** — closed-lid / closed-mouth figures legitimately paint 0 for eyes/teeth, so a blanket gate would false-positive. Note `components` here is the Node SSR count and can still **under-report vs the browser bake** for near-threshold thin features (see the headless-`componentCount` callout above) — trust `figure:smoke` for *paint resolution*, still verify *component splits* in the browser bake.

**Delegate multi-pass visual iteration to the `model-sculpt` subagent.** Each preview PNG you `Read` in the main context stays there and is re-billed every subsequent turn — image tokens compound. For 3+ render passes on the same model, delegate to `model-sculpt` (or `general-purpose` with its instructions): it owns the render→look→adjust loop in its own disposable context and returns only text. The main agent calls `SendUserFile` to ship the final PNG to the user **without** reading it.

> **`-p key=val` only binds when the model declares a `paramsSchema`.** If the stat block shows no `paramsSchema` field, the `-p` override is silently ignored and the render is byte-identical to the baseline. Declare params via `api.params = { ... }` in your snippet to enable overrides. If two renders return the same `triCount`/`bbox` after a `-p` change, missing `paramsSchema` is the first thing to check.

> **`scripts/build-catalog-entry.cjs` requires a visible display** (headed Chromium for real WebGL thumbnails). In this container: `xvfb-run -a node scripts/build-catalog-entry.cjs <entry.js> <out.json> --palette palette.json`. `catalog-regen.cjs` already uses `headless: true` — the single-entry script still doesn't. If the script exits immediately with a Chromium launch error, `xvfb-run` is the fix.

> **CLI agents vs in-app/extension AI.** `model:preview` is for agents running in *this repo* (you). The in-app and chrome-extension AI cannot run a CLI — they verify with the in-browser `renderViews()` / `runAndSave(code, label, {maxComponents})` and read `public/ai/*.md` subdocs (e.g. `mechanisms`). Keep tool-specific instructions in `CLAUDE.md`/`docs/` (this audience) and in-browser instructions in `ai.md`/subdocs (that audience).

## AI Agent Workflow & API Reference

For the full Manifold/CrossSection API, `window.partwright` console API, session workflow, verification patterns, and photo-to-model workflow, see `public/ai.md`. The legacy `window.mainifold` alias remains available for older prompts.

### In-app AI chat — five providers

The right-side AI drawer can drive Partwright through any of:

- **Anthropic (cloud)** — user pastes their own API key (`src/ai/anthropic.ts`). Streams from Anthropic's hosted Claude with prompt caching on the long system prompt + tool list.
- **OpenAI (cloud)** — `src/ai/openai.ts`. Raw `fetch` with SSE streaming; no extra SDK. Routes per model: reasoning models (`gpt-5*`, `o1/o3/o4`) use the Responses API (`/v1/responses`); all others use Chat Completions (`/v1/chat/completions`). See `docs/ai-internals.md` for routing details.
- **Google Gemini (cloud)** — `src/ai/gemini.ts`. Raw `fetch` against `generativelanguage.googleapis.com` with SSE streaming via `:streamGenerateContent?alt=sse`; no extra SDK. Requires careful handling of `functionResponse.response` (plain object, not JSON string) and `thoughtSignature` echo-back. **Tool schemas must stay within Gemini's OpenAPI subset** — it 400s the *entire* tool list on any JSON-Schema keyword it doesn't recognize (`Unknown name "X" … Cannot find field`), so `sanitizeSchemaForGemini` strips the known offenders (`$schema`, `additionalProperties`, `exclusiveMinimum`, `exclusiveMaximum`). When you add a tool param in `src/ai/tools.ts` that uses a less-common keyword, extend that strip set in the same change. See `docs/ai-internals.md` for thought-signature and routing details.
- **Local (WebGPU)** — runs a model entirely in the browser via [WebLLM](https://webllm.mlc.ai) (`src/ai/local.ts`). The user opts in from the AI settings modal and the weights download once into the browser cache. No API key, no network traffic per turn.
- **Custom (OpenAI-compatible)** — `src/ai/custom.ts`. Points to any OpenAI-compatible endpoint (llama.cpp, vLLM, LM Studio, Ollama, …). User sets a base URL in AI settings; optional API key stored in `aiKeys` keyed by `'custom'`. Model id and base URL live on `ChatToggles` as `customModel` / `customBaseUrl`.

API keys live in IndexedDB (`aiKeys` store, keyed by provider). `ChatToggles` carries a separate model id per provider (`anthropicModel`, `openaiModel`, `geminiModel`, `localModel`, `customModel`) so switching providers preserves each one's previous selection — see `activeModel(toggles)` in `src/ai/types.ts`.

All providers share the same chat loop (`src/ai/chatLoop.ts`), the same tool schemas (`src/ai/tools.ts`), and the same `public/ai.md` system prompt (or its slim local variant) — only the request transport differs. `chatLoop` dispatches by `toggles.provider` via an if/else chain at the streamTurn call site. The WebLLM SDK is still loaded via dynamic `import()` so users who stick with hosted providers never pay the ~6 MB chunk download.

See `docs/ai-internals.md` for per-provider thinking/auto-continue wire-format details (thinking box, thought signatures, thinking level mappings, auto-continue implementation, OpenAI routing).

#### Cross-provider review

A "👁" button in the panel header opens `src/ui/aiReviewModal.ts`. The user picks a **different** provider/model than the one driving the chat, optionally types a focus prompt, and the reviewer is sent the current code + geometry stats + 4-iso snapshot + session notes via a single non-tool turn. The response lands as a `'review'` `ChatBlock` rendered with a distinct purple-bordered bubble in the transcript AND a `[REVIEW from <provider> / <model>] …` session note (so the primary agent picks it up on its next turn via `getSessionContext()`).

#### AI Call Log (per-provider diagnostics)

A "🩺" button in the panel header opens `src/ui/aiDiagnosticsModal.ts`. Shows the last 50 provider API calls from an in-memory ring buffer (`src/ai/diagnostics.ts`): provider/model/kind, duration, status, full error messages (errors auto-expand), token usage, stop reason, request summary. Filter (all/errors/successes), Clear, Copy JSON. This is distinct from the app-wide **Diagnostic Log** (`src/diagnostics/errorLog.ts`, toolbar ⚠ button) which captures uncaught errors, intercepted `console.warn`/`console.error`, and every toast (see [User Messaging & the Diagnostic Log](#user-messaging--the-diagnostic-log)); the AI Call Log adds per-call detail (successes, tokens, the "empty_final" non-error case) the general log intentionally doesn't. To avoid double-listing, the AI Call Log mirrors to `console.info`/`console.debug` (not `warn`/`error`), and hard provider errors reach the app-wide log via `chatLoop`'s `onError → errorLog.capture({source:'ai'})`.

#### Slash commands

The AI chat input supports `/command` shortcuts (`src/ai/slashCommands.ts`). A lone `/word` is parsed before being sent to the model; anything else (a path like `/usr/bin`, or `/think it over`) is forwarded normally.

| Command | What it does |
|---|---|
| `/compact` | Summarize older turns and promote insights to session notes |
| `/clear` | Delete this chat (saved versions & notes are kept) |
| `/repair` (alias `/fix`) | Repair corrupted tool history (orphaned tool calls) so a chat wedged on a provider 400 can send again |
| `/review` | Open the cross-provider review modal |
| `/export` | Download the conversation as Markdown |
| `/models` (alias `/settings`) | Open AI settings modal |
| `/portrait` (alias `/bust`) | Prefill a prompt to model a stylized 3D bust from a photo you attach |
| `/help` (alias `/commands`) | List all commands in chat |

The command names and descriptions are defined in `SLASH_COMMANDS` in `slashCommands.ts`; the panel's handler map is type-checked against `SlashCommandName` so a name can't exist without a handler. Tests: `tests/unit/slashCommands.test.ts` (unit), `tests/ai-slash-commands.spec.ts` (e2e).

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
- `src/geometry/engines/voxel.ts` — voxel-grid engine (pure JS, no WASM). User code calls `api.voxels()` then `v.set`/`v.fillBox`/`v.sphere`/`v.line` and `return v`. Backs the `voxel` language, VOX export, the image→voxel import, and the `voxelize` surface modifier.
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
- `src/surface/modifiers.ts` — Surface modifier pipeline (`SurfaceModifierId = 'fuzzy' | 'knit' | 'cable' | 'waffle' | 'fur' | 'woven' | 'knurl' | 'voronoi' | 'voronoiLamp' | 'engrave' | 'smooth' | 'voxelize'`): `applyFuzzy` (noise-displaced skin), the fabric-texture family `applyKnit` / `applyCable` / `applyWaffle` / `applyFur` / `applyWoven` (stockinette knit, cable knit, waffle stitch, fur/velvet, woven fabric — displaced along normals over a UV unwrap, with WebGPU compute where available), `applyVoronoi` (Voronoi cell relief), `applyVoronoiLamp` (perforated SDF lamp shell), `applySmooth` (Taubin smoothing pass), `applyVoxelize` (mesh → voxel grid), `applyScale` (non-destructive resize — `scaleModel` also has a parametric `mode` that wraps the source in `.scale(...)` via the `placement.ts` transform chain, like place/rotate). Knurl takes a `profile` knob (`'round'` cosine bumps vs `'pyramid'` straight-sided machinist diamonds). Most modifiers also have an `apply*Patch` variant that textures only a selected triangle set. **The engrave/emboss SDF carve runs off the main thread** in `engraveWorker.ts` (via `engraveWorkerClient.ts` → `engraveInWorker`); `applyEngrave`'s assembly half is split into `buildEngraveResult` so the heavy `engraveMesh` sweep can run in the Worker while the cheap paint-transfer/version-code stays main-side (terminate-on-cancel, progress messages drive the inline "Rendering… Xs"). Each returns a `ModifierResult` — either `'manifold'` (baked mesh + wrapper code, mirroring the STL import path) or `'voxel'` (encoded grid + inline `voxels.decode(…)` code). Pure math lives in sibling modules: `fuzzySkin.ts`, `knitTexture.ts`, `knitTextureGPU.ts`, `cableKnit.ts`, `waffleStitch.ts`, `furVelvet.ts`, `wovenFabric.ts`, `knurlTexture.ts`, `voronoiShell.ts`, `voronoiLattice.ts`, `voronoiLampSdf.ts` (over the `sdfModifier.ts` scaffolding), `engraveSdf.ts`, `smoothSurface.ts`, `voxelizeMesh.ts`, `meshSubdivide.ts`, `colorTransfer.ts`, `scaleMesh.ts`, plus the UV layers `uvParameterize.ts`, `uvUnwrap.ts`, and `placement.ts` (region placement). Unit tests: `tests/unit/surface.test.ts`.
- `src/surface/surfaceOps.ts` + `surfaceOpSpec.ts` — the **in-code** (non-baking) surface-texture path: manifold-js model code declares textures via `api.surface.*` (`fuzzy`/`knit`/`cable`/`waffle`/`fur`/`woven`/`knurl`/`voronoi`/`smooth` — the mesh-producing subset; `voxelize`/`voronoiLamp` change engines so they stay bake-only). The Worker records the validated op chain (`surfaceOpSpec.ts` is the dependency-free shared spec — its option allow-lists are effectively **append-only** once user code persists them, since unknown keys throw), `surfaceOps.ts` applies it in the dedicated **surface Worker** (`surfaceWorker.ts` + the pure kernel `applyChain.ts` — the modifier math is Worker-clean, WebGPU included), memoized per chain prefix on the **base mesh content** (`meshContentKey`), so whitespace/comment/refactor edits that don't change geometry hit the cache instantly and never drop the textures. **Every run applies the chain** — explicit and live-typing alike — behind an inline "Applying texture… Xs" status + the shared Cancel button (the "Rendering… Xs" pattern); Cancel (terminate+respawn, the only true interrupt for synchronous math) parks the chain behind the sticky "⟳ Re-apply" pill, and `ensureSurfaceTexturesApplied()` (which the Surface panel awaits before previews) recovers it. Computed textures **persist on saved versions** (`Version.surfaceTexture` = full-chain memo key + textured mesh, export schema 1.14): a version load seeds the memo cache so a reopened session renders textured instantly with no recompute, pinning the texture's appearance at save time — a stale key just recomputes (never renders the wrong texture). The **Surface panel writes this path too**: in a manifold-js session with whole-model mode, Apply becomes "Apply as code" and upserts the `api.surface.<id>({…})` call via `src/surface/surfaceCodegen.ts` + `partwright.applySurfaceTextureAsCode` (region/patch flood-fill applies, voxelize/voronoiLamp, and SCAD/BREP sessions keep the bake path). **Ops can be scoped** to part of the model with a `label` (an `api.label` region) or `region: {point, radius}` key — `parseSurfaceOpts` (in `surfaceOpSpec.ts`) is the single validator shared by the Worker recorder and the console twin; the main thread resolves the scope to seed points + a catch radius (`resolveSurfaceScopes` in `main.ts`), and the surface Worker selects triangles near the seeds (`selectTrianglesNearSeeds` in `colorTransfer.ts`) then runs the existing `apply*Patch` path. The panel's whole-model **Scope** picker (label dropdown / "Near point" click) writes these. `api.label`/`byLabel` colors carry through any texture via `remapTriangleSets` (the nearest-centroid map the bake path also uses). The sibling `api.paint.*` (recorded in `engines/manifoldJs.ts`, resolved into the model-color underlay in `src/color/regions.ts`) declares paint in code the same way. Unit tests: `tests/unit/surfaceOps.test.ts`, `tests/unit/surfaceCodegen.test.ts`; e2e: `tests/surface-in-code.spec.ts`, `tests/surface-panel-as-code.spec.ts`, `tests/paint-in-code.spec.ts`.

### Modeling engines (four of them)

Partwright supports four language/engine pairs. The mesh-side pipeline below the engine boundary (painting, render, ray-cast, export, queries) is engine-agnostic — anything new that lives there works across all four.

| Language | Engine | Kernel | Unique features |
|---|---|---|---|
| `manifold-js` (default) | manifold-3d | mesh | `warp`, `levelSet`, `smoothOut`, `Curves` helpers, fast booleans on weird shapes |
| `scad` | OpenSCAD via `openscad-wasm-prebuilt` | CSG | BOSL2 (`threaded_rod`, `spur_gear`, `cuboid(rounding=)`, …) |
| `replicad` | OpenCASCADE via `replicad-opencascadejs` | BREP | True selective edge fillets/chamfers, STEP export, exact surfaces |
| `voxel` | in-house JS voxel grid (`src/geometry/engines/voxel.ts`) | voxel grid | Blocky colored cubes (Minecraft / pixel-art); `api.voxels()` + `v.set`/`v.fillBox`/`v.sphere`/`v.line`; VOX export; target of image→voxel import and `voxelizeModel` |

> **Engine awareness for mesh-side tools.** Most tools work off the engine-agnostic tessellated mesh and need no special casing. But anything that *bakes a result back into a session* (surface modifiers, scale/place/rotate transforms, voxelize) converts a SCAD/BREP session into a `manifold-js` (or `voxel`) mesh, discarding the parametric source — and for BREP, STEP export. Those paths emit a user-facing warning via `engineBakeWarning` (see `commitSurfaceModifier` / `commitTransform` in `src/main.ts`); preserve that warning when adding new commit paths.

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

### Session Schema Migrations

When adding a field to the persisted session schema, **seven locations must stay in sync** — missing one trips a CI test or silently corrupts imports:

1. `SCHEMA_VERSION` constant in `sessionManager.ts` (bump it)
2. `ExportedSession` type + its doc-comment version ladder
3. Serialize path (save / export)
4. Deserialize path — **both** import loops (`importSessionPayload` + the URL-param import)
5. `trimForShare` — strip if the field is large or private
6. Tests that assert `SCHEMA_VERSION` — import the constant instead of hardcoding the string, so a bump doesn't break them silently
7. `dbSaveVersion` call sites — the positional signature is now 16+ args; use `null` placeholders for trailing fields or convert the tail to an options object before adding more

### Cross-Tab Isolation — No Data Bleed Between Windows

The app runs in multiple browser windows/tabs at once, often each driving a **different session** (and a different AI provider). Tabs share one origin, so they share IndexedDB *and* localStorage; separate windows do **not** share JS module memory. The rule:

> State must not bleed or cause side effects from one tab into another. The only times state should cross tabs are the **explicit** transitions: opening a session (incl. a previously-closed one) in a tab, or **taking control** of a session in another tab. Anything else changing in tab B must not silently alter tab A.

See `docs/architecture-notes.md` for the concrete implementation patterns (per-tab prefs, `storage`-event scoping, global-state rules).

### UI ↔ JS-API parity — the AI must be able to drive what the UI can

A core product goal: **anything a user can do from the UI, an AI agent can do through `window.partwright`** (the console / external-agent surface) and, where it fits, the in-app AI tool layer. New UI affordances drift out of parity *silently* — the mid-2026 feature audit found whole capabilities (smooth/voxelize/scale/orient, image-stamp paint, STL import, version rename/delete) reachable only by clicking. When you add or change a user-facing capability, close the loop in the **same PR**:

1. **Add the `window.partwright` method** in `partwrightAPI` (`src/main.ts`), validating arguments with the `guard()` / `assert*` helpers (`src/validation/apiValidation.ts`) so console/MCP callers get the same checks as the UI. Return `{ error }` on bad input from value-returning methods; don't throw.
2. **Register it in the `help()` table** (`src/main.ts`) — that's the discoverability surface and it must not drift from the implementation.
3. **Document it** in `public/ai.md` (the console-API list) and the relevant `public/ai/*.md` subdoc (`file-io`, `textures`, `printing`, …). External agents read these.
4. **Consider an in-app AI tool** (`src/ai/tools.ts`): a schema + dispatch case + the correct gating set (`SAVE_GATED` / `PAINT_GATED` / …) when the chat AI should drive it. Skip it only when it can't be driven from chat (e.g. needs local file bytes) or is too destructive to expose unscoped — and say which in the PR.

> A pure static lint can't tell that a new DOM button lacks an API method — there's no typed link between the two — so **this same-PR norm plus the `work-reviewer`'s parity check are the enforcement**, not a gate. (The robust structural fix would be a single capability registry both the command palette and the API derive from; that's a deliberate larger refactor, not done yet.) `npm run lint:consistency` (ast-grep) *does* catch the related UI-*consistency* drift — modals not on `modalShell`, buttons bypassing the `BUTTON_*` constants — so run it, and prefer promoting a clean rule to `error`.

**Cross-engine parity is part of this.** A tool that bakes or commits a result must work for — or explicitly warn about — all four engines; don't add a commit path that silently assumes manifold-js. See the engine-bake note under [Modeling engines](#modeling-engines-four-of-them).

### Numeric Constants and App Config

Never hardcode numeric tuning constants — timeouts, limits, thresholds, budgets, quality knobs — directly in source files. Instead:

1. **Add the constant to `src/config/appConfig.ts`** — pick the right section (`ai`, `renderer`, `import`, or `ui`), add a typed field to `AppConfig`, a default in `APP_CONFIG_DEFAULTS`, and a JSDoc comment explaining what it controls.
2. **Read it with `getConfig().<section>.<field>`** at the call site rather than storing it in a module-level `const`. This lets the user's saved override take effect immediately.
3. **Expose it in `src/ui/advancedSettingsModal.tsx`** — add a `<Field>` inside the matching `<Section>` with `label`, `hint`, `defaultValue`, `min`, `max`, and an `onChange` that calls `set(section, key, v)`.
4. **Worker context**: `getConfig()` in a Worker returns static defaults (no `localStorage`). If the value must be live for a Worker, thread it through the relevant message (e.g. `toolCallTimeoutMs` is passed via the `run_turn` message in `agentWorkerClient.ts`).

The only exceptions are values that are truly structural constants (array indices, enum values, magic bytes) rather than tunable knobs.

### Dead Code

Don't export functions unless they're imported elsewhere. When removing usage of an exported function, delete the export too. Periodically grep for exported symbols to verify they have importers — or run `npm run lint:deadcode` (knip), which reports exports with no importers and unused files/types.

### Editing `src/main.ts` — NUL-byte zones

`src/main.ts` embeds literal NUL bytes (`\0`) as separator characters inside template-literal cache keys (e.g. `surfaceBaseKey`). Standard tools treat the file as binary:

- **`grep`/`rg` silently truncate results** or skip the file — use `grep -a` or `rg -a` for any search targeting `main.ts`.
- **`Edit` and most regex engines fail on the NUL boundary** — use a Python slice-between-anchors script instead: `python3 -c "t=open('src/main.ts','rb').read(); ..."`.

If a grep on `main.ts` returns nothing for a symbol you expect to find there, binary-detection is the first thing to check. Three independent sessions have each spent 4+ turns re-discovering this.

### Agent Tooling & Static Analysis

This repo ships custom Claude Code subagents and a deterministic static-analysis layer they lean on — see `docs/agent-tooling.md` for the full reference. In short:

- **`work-reviewer`** (`.claude/agents/work-reviewer.md`, Opus, read-only) reviews the branch diff vs `origin/main` for correctness, back-compat, security, and **UI consistency** against the shared component layer (`modalShell`, `styleConstants` `BUTTON_*`, `showToast`, `commandPalette` keyboard model). Launch it before marking a PR ready.
- **`explore`** (`.claude/agents/explore.md`, Sonnet, read-only) overrides the built-in Haiku Explore agent for sharper codebase discovery, preferring the Serena LSP MCP (`mcp__serena__*`, configured in `.mcp.json`) for reference/definition queries.
- **Search ladder** — match the search modality to the question (full guidance in `docs/agent-tooling.md`): `Grep` (ripgrep) for literals/strings → `npm run ag -- run -p '<pattern>' -l ts src` for code *shapes* (call-site sweeps, convention checks — `$X` matches one node, `$$$` any number; no comment/string false positives) → Serena (`find_symbol` / `find_referencing_symbols` / `get_symbols_overview`) for resolved references over the real type graph ("who actually uses this export"). Delegate broad multi-file discovery to the `explore` agent rather than running the fan-out in the main context. **Run ast-grep via `npm run ag --` (after `npm ci`), not `npx ast-grep`** — on a bare container (no `node_modules`) `npx ast-grep` silently pulls a squatted impostor package instead of the pinned `@ast-grep/cli`. And a bare-identifier pattern like `runAndSave($$$)` won't match method calls (`api.runAndSave(...)`) — use the member form `$OBJ.runAndSave($$$)`. See `docs/agent-tooling.md`.
- **`lint:consistency`** (ast-grep), **`lint:deadcode`** (knip), and **`lint:deps`** (madge) run in CI (`code-quality.yml`). `lint:consistency` gates on `error`-severity ast-grep rules (`no-native-dialogs` is `error`; the rest are `warning`/`hint` — promote one to `error` once the codebase is clean for it). `lint:deadcode` gates on knip's trustworthy categories (`dependencies`/`unlisted`/`unresolved`/`files`) but keeps `exports`/`types` advisory (knip can't see exports used only via the e2e suite's dynamic `import('/src/…')`, and the dead-export backlog needs per-symbol triage). `lint:deps` (madge circular deps) is a **gate**: the module graph is acyclic, so any new cycle fails CI. Scope each advisory hit to the diff — they over-report by design. See `docs/agent-tooling.md`.

### Module Layering — keep the dependency graph acyclic

The module graph is **cycle-free** and CI gates on it (`lint:deps`). To keep it that way, follow the dependency direction and the patterns below — they're the ones used to untangle the original cycles, and each has a canonical example in the tree:

- **Direction:** the renderer (`src/renderer/viewport.ts`) is a *low* layer; feature layers (`src/annotations/`, `src/color/`) sit above it and may import it (`requestRender`, camera accessors), but **the renderer must never import a feature layer.** When the viewport needs to drive a feature subsystem (phantom geometry, annotation overlay, session plane), the subsystem registers a lifecycle hook via the leaf `src/renderer/viewportRegistry.ts` (wired in `src/renderer/viewportSubsystems.ts`, imported once for side effects in `main.ts`) instead of the viewport importing it.
- **Mutually-exclusive tools coordinate through a leaf, never each other.** Paint and the annotate sub-modes (pen/text/select) register their `forceDeactivate` with `src/ui/modeExclusion.ts` and call `deactivateMode(id, opts)` to turn a sibling off. No mode imports another mode.
- **Shared state that two mutually-importing modules both need goes in a leaf.** Selection state lives in `src/annotations/selectionState.ts` (so the overlay can observe it without importing `selectMode`); paint-state accessors the drag tools read live in `src/color/paintAccessors.ts` (published once by `paintMode`). The owning module sets the leaf; consumers read it.

When you add a feature that would otherwise import "sideways" or "down into" a lower layer, reach for one of these leaf patterns rather than adding the back-edge. Run `npm run lint:deps` before pushing.

### Issue hygiene — don't lose work or discoveries at a boundary

GitHub issues are the durable memory; a chat session is not. Insights, defects, and half-finished scope that live only in chat replies vanish when the session ends. You do **not** need to open an issue before starting ad-hoc work (that friction would kill the fast chat-driven flow) — but you **must reconcile issues at every completion boundary** (a PR opened/merged, or a task declared done).

**Multi-deliverable sessions are the #1 way work leaks.** A dynamic session often fans out into 3–4 intended deliverables, but only the first becomes a PR — and the rest, which lived only in the chat, evaporate when the session ends or its context compacts. Every other durable mechanism here (prompt logs, retros, this close-out nudge) writes at the *end* of work; nothing records the *plan*. So when work is multi-part, capture the **full set** the moment you recognize it, in a place that outlives the conversation:

- **Open one tracking issue per multi-deliverable session** — not one per item; keep the granularity low. Title it `[tracking] <session intent>` with a task-list checklist of the deliverables. **Run `/scope`** to do this. Each deliverable's PR refs the issue and ticks its box; the issue closes only when every box is ticked, so unfinished items survive as the next session's pickup list.
- **Every multi-part PR carries a scope manifest in its body** — the "Part X of N" sibling checklist (see [Commit & PR Conventions](#commit--pr-conventions)). It rides on the artifact you're looking at when you merge, so leftovers are visible at the exact moment of loss and the weekly `/issue-reconcile` can find them.

Before you say "done":

1. **Discoveries get filed.** Any defect, gap, or "we should also…" you find *while implementing* — something out of scope for the current change — becomes a GitHub issue **before you move on**, not just a sentence in chat. (Example: the carved-mouth-at-small-head defect found while adding figures → filed as its own bug.)
2. **Partial implementation never closes silently.** If a PR merges but doesn't fully satisfy its originating issue, that issue stays **open** with a checklist of what's left — or you file an explicit follow-up issue (tick the matching box on the tracking issue / scope manifest rather than closing the umbrella). Only close a source issue when **every** acceptance criterion is actually met; a merged PR is not automatically a completed issue.
3. **Close-out reconciliation.** When you finish a task (and again after a merge), state in chat: *did this fully satisfy the source issue? what was deferred, and where is it tracked? is the tracking issue's checklist current? what did I discover, and did I file it?* Resolve each — done, or tracked in an issue — before ending the turn.

This is boundary hygiene, not bureaucracy: the test is "could the next session pick up everything important without reading this chat?" The `Stop` hook nudges you toward this reconciliation whenever the working tree is dirty **or your branch has unmerged commits** (so it fires even after a clean commit-and-push); the weekly **`/issue-reconcile`** skill is the backstop that walks merged PRs and tracking issues to re-file anything that slipped. The call on *what* warrants an issue is yours, but "nothing tracked it" is the failure mode to avoid.

### Retros — continuous improvement loop

This repo runs a lightweight self-improving loop so agents make the *next* agent faster and more reliable. See `retros/README.md` for the full picture.

- **When you finish a meaningful task (≈ a PR), run `/retro`** (`.claude/skills/retro.md`). It drops a short **4-Ls** reflection — *Liked · Lacked · Learned · Longed for* — into `retros/inbox/`. Think like an engineer about your own toolchain: the most valuable note is what would have made delivery faster (the "Longed for" bucket), not just what broke. A `Stop` hook nudges you when the tree is dirty, but the call is yours — skip it when nothing was notable. Entries are append-only and commit with the work.
- **`/retro-review`** (`.claude/skills/retro-review.md`) is the weekly facilitator, fired by a scheduled trigger. It clusters the inbox (frequency across independent agents = the vote), applies the confident process diffs to `CLAUDE.md`/`docs`/skills, files tooling asks as backlog items, writes a durable report to `retros/reports/`, archives the entries, and opens a **draft PR** for human review. It never merges itself.

### Prompt Logs

Every commit that changes non-prompt files must also stage a sanitized **prompt log** under `prompts/`, documenting the human request and your key decisions behind the change. See `.claude/skills/promptlog.md` for the format (one YAML frontmatter block, `## Human` / `## Assistant` decision-focused sections — write *why*, not a changelog). A `PreToolUse` guard (`.claude/hooks/promptlog-guard.sh`) **blocks** any `git commit` that touches non-prompt files without one; for a genuinely mechanical commit (merge/rebase/backfill) re-run with `--no-verify`.

> This guard is the harness-level replacement for the old `lefthook` `prompt-log` pre-commit rule, which silently stopped firing in web/remote sessions because git hooks are never installed there (no `npm install` → no `lefthook install` → empty `.git/hooks`). A skill on disk doesn't run itself; the hook is what makes the workflow actually fire.

### User Messaging & the Diagnostic Log

There is **one** messaging system; use it, don't invent parallel ones. Every error, warning, or notice a user sees must also land in the central **Diagnostic Log** (`src/diagnostics/errorLog.ts`, toolbar ⚠ button) so there's a durable, reviewable record — the on-screen surface is transient, the log is the history.

- **Transient notifications → `showToast` (`src/ui/toast.ts`).** A toast is the standard bottom-center, fades-away message for save/export confirmations, action feedback, and recoverable failures. Every `showToast` is **automatically mirrored** into the Diagnostic Log, so you don't capture separately for toasts. Variant maps to log level: `warn` → `'warn'`; `success`/`neutral` → `'info'` (routine activity, recorded but kept out of the unseen-error badge). Pass `{ log: false }` only for the rare toast that must stay screen-only, and `{ source }` to tag the subsystem (`'import'`, `'export'`, …).
- **Variant semantics.** `success` = it worked; `neutral` = informational/in-progress; `warn` = something went wrong or was blocked. Pick by meaning, not color. Don't hand-roll `position:fixed` message nodes — route through `showToast`.
- **Failures that don't toast → `errorLog.capture({ level, source, message, detail })` directly** with an explicit `source` tag. Anything caught in a `catch` that the user won't otherwise see (Worker/engine failures, background tasks) belongs in the log even when there's no toast.
- **Persistent status ≠ transient notification.** Standing indicators that reflect *current* state — e.g. the viewport **printability pill** (`printabilityIndicatorEl` in `src/main.ts`), which stays up while the live model has print-blocking structural issues — are *status*, not toasts. They persist until the underlying state changes and must not be implemented as (or mistaken for) fading messages. Give them a `title` so users understand what they are.
- **Don't assert what you didn't measure.** Render-only imports (e.g. colour reliefs) carry no `Manifold`, so `isManifold` is `false` for lack of measurement — *not* because the mesh is non-watertight. `computePrintability` treats that case (`manifoldStatus === 'render-only (not manifold)'`) as unverified rather than failed, so the pill doesn't cry "not watertight" about a mesh that was verified watertight at build time.

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

**Scope manifest — multi-part PRs declare their siblings.** When a PR is one slice of a larger intent, put a checklist at the top of the body so the full scope is visible at merge time (the moment leftover work is most easily lost):

```
Part 1 of 3 of "<session intent>" (tracking: #N):
- [x] this PR — <what it does>
- [ ] <sibling 2> — <tracked: #M, or "not yet filed">
- [ ] <sibling 3> — …
```

Tie it to the session's `[tracking]` issue (`#N`) when one exists (see [Issue hygiene](#issue-hygiene--dont-lose-work-or-discoveries-at-a-boundary) / `/scope`). The weekly `/issue-reconcile` greps merged PR bodies for unchecked sibling boxes, so the manifest is what lets a leftover get re-filed instead of forgotten.

### Agent working discipline (git, PRs, tool output)

Guardrails for automated work, learned the hard way:

- **Irreversible GitHub actions stand alone, after an explicit decision.** Closing or merging a PR, deleting a branch, or force-pushing is outward-facing and hard to undo. Never batch such a call in the same tool block as other work (a sibling call fires even if the call meant to gate it errored or was never answered), and never infer the go-ahead — issue it as its own step only when the user explicitly asked for it. A PR close/merge is never a default or a guess. (A `PreToolUse` hook in `.claude/settings.json` also pauses for confirmation before `merge_pull_request` and a `state: closed` `update_pull_request`, as a backstop.)
- **A failed or unreadable tool result is not a success.** If a call errors (e.g. an `AskUserQuestion` that didn't validate) or its output comes back garbled / empty / out-of-order, re-run or re-verify state before proceeding — never act on an answer you didn't actually receive, and never treat a laggy/garbled shell as ground truth.
- **Git is single-writer.** The working tree and index are shared mutable state. Don't run git mutations while a subagent is also touching the same checkout. Resolve merges/rebases inline yourself; if you must delegate git work to a subagent, give it an isolated worktree (`isolation: "worktree"`).
- **Verify state between destructive git steps.** After a merge / rebase / reset, confirm `git status` and HEAD, and that local HEAD matches what you pushed, before moving on.

### After Opening a PR

Opening the draft is the start of the verification phase, not the finish line. The task is done when every PR-checks shard is green.

1. **Subscribe and watch CI.** Call `subscribe_pr_activity`. PR-checks runs build + unit + 3 e2e shards on every push, draft or ready — don't flip to ready to trigger it. Fix failures on the branch (each push re-runs the suite); fall back to local `npm run test:e2e` only when iterating tight on a CI failure. **`send_later` is unavailable in web/remote sessions** — there is no automated self-wake after a push. Webhook events drive the session forward; CI-success is not delivered as a webhook. If you need to self-check after the last push, use a Monitor-based background poll (arm it before ending the turn) rather than sleeping in a loop.
2. **Confirm manual browser verification happened.** If you haven't yet exercised the feature in the browser and posted a screenshot in the chat, do it now — write/run a Playwright spec that navigates to the changed feature and screenshots the result, then view and post the PNG (see [Manual Verification](#manual-verification--checking-your-work-in-the-browser)). There is no Playwright MCP here; the spec is the check. The user is watching this session and this is the most direct signal that the feature works.
3. **Launch a review subagent** (Agent tool) over the diff vs `origin/main`. Hunt for: defects and unhandled cases; functionality silently dropped in a merge; backwards-incompatible schema changes (old IndexedDB sessions and exported files must still load); security issues (XSS, leaked keys, weakened CSP/COEP/COOP). Surface findings as PR comments or fold clear fixes into the branch; raise ambiguous/large ones with the user.
4. **Auto-fix CI failures you're confident about.** Reproduce locally first. Re-sync `origin/main` if the branch has drifted, then push the fix. Ask the user for anything ambiguous, unrelated to your changes, or requiring a large refactor.
5. **Resolve merge conflicts when `main` advances.** Treat a stale/conflicting branch like a CI failure — actionable, not parkable. Fetch + merge `origin/main`, resolve conflicts by reconciling both sides (never drop recently-merged work to make your side apply cleanly), then prove it still works: `npm run build` + `npm run test:unit`, let CI re-run e2e, redo any manual verification the touched area warrants. Stop and ask if the conflict is large or lands in code you don't understand.
6. **Keep the PR description in sync** with the totality of what's on the branch — update Summary, Test plan, title/prefix/labels any time you push follow-up work.
7. **Mark ready, label, confirm green.** Once every shard and the Cloudflare preview are green and the review pass is clean: `update_pull_request` with `draft: false`, apply [release-note labels](#commit--pr-conventions).

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
