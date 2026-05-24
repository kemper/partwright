# Partwright

A browser-based CAD tool designed for AI-driven 3D modeling. Write JavaScript code, get instant 3D geometry — no backend, no installs.

Built on [manifold-3d](https://github.com/elalish/manifold) (fast WASM boolean engine), [Three.js](https://threejs.org/) (rendering), and [CodeMirror](https://codemirror.net/) (editor).

## What it does

- **Code-driven CAD** — Write JS that constructs 3D geometry using primitives, booleans, extrusions, and revolves. Hit Run, see the result.
- **AI-friendly** — A `window.partwright` console API lets AI agents create, validate, and iterate on designs programmatically. Structured geometry data (volume, bounding box, cross-sections) is always available in the DOM for verification.
- **Session & versioning** — Save multiple design variations, then open a gallery view to compare them side-by-side. Ideal for AI workflows that generate N variations for human review.
- **Multi-view rendering** — Interactive 3D viewport plus headless `renderViews`/`renderView` APIs that composite any set of angles on demand (including a `box` preset covering all six orthographic faces).
- **Cross-sections** — Slice geometry at any Z height, inspect the 2D profile as SVG.
- **Color regions** — Paint coplanar face regions with the in-app paint mode or the `paintRegion` console API; colors flow through GLB and 3MF exports for multi-material slicing.
- **Export** — GLB, STL, OBJ, and 3MF download. GLB and 3MF carry per-region colors when present.

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/) for the landing page, or [http://localhost:5173/editor](http://localhost:5173/editor) to go straight to the editor (recommended for AI agents, which drive the tool via the `window.partwright` console API).

## How it works

The editor runs user code in a sandboxed function. Code receives an `api` object with `Manifold`, `CrossSection`, and `setCircularSegments`, and must `return` a Manifold:

```javascript
const { Manifold, CrossSection } = api;

// Create a plate with rounded edges and a bolt hole
const plate = Manifold.cube([40, 30, 5]);
const hole = Manifold.cylinder(5, 3, 3, 32).translate([20, 15, 0]);
return plate.subtract(hole);
```

All transforms are immutable — methods return new objects, originals are unchanged. Method chaining works naturally:

```javascript
Manifold.cube([10, 10, 10], true)
  .subtract(Manifold.cylinder(12, 3, 3, 32))
  .translate([0, 0, 5]);
```

## Keyboard shortcuts

Shortcuts adapt to your OS — use **⌘** on macOS and **Ctrl** elsewhere.

| Action | macOS | Windows / Linux | What it does |
|--------|-------|-----------------|--------------|
| Undo | ⌘ Z | Ctrl + Z | Undo the last paint region or annotation stroke (whichever tool is active). In the code editor, its built-in undo applies. |
| Redo | ⇧ ⌘ Z | Ctrl + Shift + Z, or Ctrl + Y | Redo the last undone paint region or annotation stroke. |
| Save version | ⌘ S | Ctrl + S | Snapshot the current code, geometry, paint, and annotations as a new version. |
| Format code | ⇧ ⌥ F | Shift + Alt + F | Reformat the editor contents. |
| Save notes | ⌘ Enter | Ctrl + Enter | Save the Notes textarea (when focused). |
| Close / cancel | Escape | Escape | Close the open dropdown, modal, paint/annotate panel, cross-section overlay, or exit the tour. |

Undo/redo route to whatever you're working on: paint regions while painting, annotation strokes while annotating, and the code editor's own history while editing code. Save works from anywhere.

## A note on AI costs & risk

Partwright is an experiment — a passion project exploring what happens when you put generative AI inside a browser-based 3D modeling tool. I've spent my own money building it; I'm not trying to make money from it, and I hope it brings others the same joy and curiosity it's brought me.

That said: **when you connect your own AI agent, it uses your API tokens.** AI-driven CAD is genuinely hard — the agent may iterate many times before producing good geometry (or not). There are some guardrails in place to help limit runaway spend, but there's no guarantee they work perfectly in every situation. **By connecting your own AI agent, you accept responsibility for any API costs incurred, regardless of output quality.** Start small, run a quick test first, and go in eyes open.

## AI Agent Setup

AI agents (Claude Code, etc.) interact with the app via `window.partwright` in the browser. The legacy `window.mainifold` alias still works for older prompts and tools. There are several ways to give an AI agent browser access:

### Option 1: Claude in Chrome extension (recommended)

The [Claude in Chrome](https://chromewebstore.google.com/detail/claude-in-chrome/ifjdokaooeocjpmoijgkndfhkmnbobkp) extension lets Claude Desktop control your active Chrome tab directly — screenshots, JavaScript execution, and DOM reading all work. No extra setup beyond installing the extension.

Best for: interactive sessions where you want to see what the AI is doing in real time.

### Option 2: Chrome DevTools MCP

If Chrome is running with remote debugging enabled (there's a Chrome setting for this, or launch with `--remote-debugging-port=9222`), Claude Desktop can connect via the DevTools protocol.

```bash
claude mcp add chrome-devtools -s user -- npx -y @anthropic-ai/chrome-devtools-mcp-server
```

Best for: using your existing browser with all your sessions/data intact.

### Option 3: Playwright MCP

Launches a separate browser instance — no Chrome setup needed.

```bash
claude mcp add playwright -s user -- npx -y @playwright/mcp
```

Best for: automated/headless workflows, CI pipelines, or when you don't want to use your main browser.

### The workflow

Whichever option you use, the AI agent navigates to `http://localhost:5173/editor`, then uses the `window.partwright` console API to create sessions, write geometry code, validate results with assertions, save versions, and hand you a gallery URL for review.

See `CLAUDE.md` for the full API reference and recommended iteration patterns.

## Console API

For AI agents and automation, `window.partwright` exposes:

```javascript
partwright.run(code)             // Execute code, returns geometry stats
partwright.validate(code)        // Syntax/logic check without rendering
partwright.getGeometryData()     // Current model stats (volume, bbox, genus, ...)
partwright.getCode()             // Read editor contents
partwright.setCode(code)         // Write to editor
partwright.sliceAtZ(z)           // Cross-section at height z
partwright.exportGLB()           // Download GLB (carries vertex colors)
partwright.exportSTL()           // Download STL
partwright.exportOBJ()           // Download OBJ
partwright.export3MF()           // Download 3MF (carries per-region materials)

// Sessions — save/compare design iterations
await partwright.createSession("Gear variations")
await partwright.runAndSave(code, "v1 - basic")
partwright.getGalleryUrl()       // URL for gallery view

// Color regions — tag coplanar faces with a color (see /ai.md#color-regions)
partwright.paintRegion({ point: [10,0,5], normal: [0,0,1], color: [1,0,0] })
partwright.listRegions()
partwright.clearColors()
```

Geometry stats are also always available as JSON in `#geometry-data` for DOM scraping.

## Examples

The toolbar dropdown includes built-in examples:

| Example | What it demonstrates |
|---------|---------------------|
| Basic Shapes | Primitives and booleans |
| Twisted Vase | Stacked cylinders with twist |
| Boolean Demo | Union, difference, intersection |
| Chess Rook | Revolve profile + circular array |
| Spur Gear | Involute tooth profile, extrude, bore |
| L-Bracket | Plate with fillets and bolt holes |
| Desk Organizer | Rounded rectangles, hollowing |
| Christmas Tree | Stacked cones with ornaments |

## Deployment

The app deploys via [Cloudflare Pages](https://pages.cloudflare.com/). Three branches form a quality-gate pipeline:

| Branch | Environment | URL | What it is |
|--------|-------------|-----|------------|
| `main` | Preview | `main.mainifold.pages.dev` | bleeding edge — deploys on every push, **before** the e2e gate |
| `staging` | Preview | `staging.mainifold.pages.dev` | last commit that **passed** build + unit + e2e (known-good) |
| `production` | Production | `www.partwrightstudio.com` | released; protected, requires PR review |

**Workflow:**

1. Open a feature branch off `main` and PR it into `main`. The push deploys the main preview immediately (pre-test, so it may be red).
2. On every push to `main`, a GitHub Action ([`staging-gate.yml`](.github/workflows/staging-gate.yml)) runs the build, unit tests, and e2e tests. Only if all pass does it fast-forward `staging` to that commit — which Cloudflare deploys to the known-good staging preview. A red gate leaves `staging` on the last good commit.
3. Once validated on the staging preview, PR from `staging` → `production` to release. PRs into `main` also get a fast pre-merge check (build + unit) via [`pr-checks.yml`](.github/workflows/pr-checks.yml).

## Architecture

Static site — vanilla TypeScript + Vite, no backend or framework.

```
src/
  geometry/engine.ts      Manifold WASM init + sandboxed code execution
  geometry/crossSection.ts  Z-slice to SVG/polygon conversion
  renderer/viewport.ts    Three.js interactive viewport
  renderer/multiview.ts   Offscreen multi-angle render API (renderViews/renderView)
  editor/codeEditor.ts    CodeMirror editor setup
  ui/layout.ts            Split-pane layout
  ui/toolbar.ts           Top toolbar with examples dropdown
  export/gltf.ts          GLB export (with vertex colors)
  export/stl.ts           STL export
  export/obj.ts           OBJ export
  export/threemf.ts       3MF export (per-region basematerials + pid)
  color/                  Paint mode, coplanar flood-fill, region persistence
```

Requires `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` headers for SharedArrayBuffer / WASM threads (configured in `vite.config.ts`).

## Deployment

Hosted on [Cloudflare Pages](https://pages.cloudflare.com/) with the production custom domain [www.partwrightstudio.com](https://www.partwrightstudio.com), served from the `production` branch. The `main` and `staging` branches deploy as previews (see the table above).

- Build: `npm run build` → `dist/`
- SPA routing via `_redirects`, COEP/COOP/CSP headers via `_headers`
- Set `SITE_URL` env var in Cloudflare Pages dashboard for absolute OG/canonical URLs (falls back to `CF_PAGES_URL`)

## Security

Partwright is designed to be controlled by AI agents, which means you're trusting the app not to embed hidden instructions that trick your AI into doing something harmful. See [SECURITY.md](SECURITY.md) for the full trust model, what the app can and can't do, and how to verify it yourself.

**TL;DR:** No backend, no outbound network requests, no analytics, no hidden DOM instructions, 7 well-known dependencies, enforced Content Security Policy.

## Coordinate system

Right-handed, Z-up. The XY plane is the ground, Z points up. Units are arbitrary — use consistent scale.
