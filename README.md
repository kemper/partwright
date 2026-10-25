# Partwright

A free, browser-based 3D CAD tool where every model is code, and you can bring your own AI to build it with you. Write JavaScript or OpenSCAD (or let an AI write it), get real 3D geometry instantly, then paint it, texture it, and export it for 3D printing. No backend, no account, no install.

**Try it:** [www.partwrightstudio.com](https://www.partwrightstudio.com)

Built on [manifold-3d](https://github.com/elalish/manifold) (fast WASM booleans), [OpenSCAD](https://openscad.org/), [OpenCASCADE](https://dev.opencascade.org/) via [replicad](https://replicad.xyz/), [Three.js](https://threejs.org/) (rendering), and [CodeMirror](https://codemirror.net/) (editor).

## What it does

**Modeling — every model is code**
- **Four engines in one app:** JavaScript on a fast **mesh** kernel (manifold-3d), **OpenSCAD** (with BOSL2 for threads, gears, and rounded parts), **BREP** solids on OpenCASCADE (true fillets/chamfers and STEP export), and a **voxel** engine for blocky, colored, Minecraft-style models.
- **Parametric by default:** declare `api.params` and get customizer sliders. Signed-distance fields for organic shapes, 3D text, and Blender-style shaping (bend, twist, taper, wrap, sculpt, rounding, scatter).
- **Tinkercad-style Arrange mode** for dropping in primitives and placing parts, plus multi-object assemblies with named parts that survive booleans.
- **Character Creator:** build posable, printable figures (body, face, hair, outfits, footwear, held accessories) with sliders and no code.
- **Catalog of ~160 ready-made models** and an **Ideas** page of starter prompts.

**AI — bring your own**
- **Built-in AI assistant** with five provider types: **Anthropic**, **OpenAI**, **Google Gemini**, any **OpenAI-compatible** endpoint (Ollama, LM Studio, llama.cpp, vLLM…), or a **local model running in your browser on WebGPU** (free, no key). Keys stay in your browser and requests go straight to the provider.
- The AI writes the code, renders the model from several angles, reads geometry stats, and fixes its own mistakes. Plan mode, auto-continue, spend caps, voice input, and image attachments.
- **Cross-provider review:** have one model critique another model's work, by hand or automatically at the end of each task.
- **Photo-driven flows:** a stylized bust from a photo, Photo → 3D, **convert an imported mesh back into editable code**, and **split an imported mesh into named, paintable parts** (hair, face, shirt…).
- **External agents** (Claude Code, browser extensions, MCP) can drive everything through the `window.partwright` console API.

**Color, texture & effects**
- **Multi-color painting:** brush, bucket fill, whole-part recolor, and projecting an image or logo onto the surface.
- **Filament palette manager:** build a palette from a photo, then paint by filament slot so colors map to your AMS.
- **Surface textures:** fuzzy skin, knit, cable knit, waffle, fur/velvet, woven, knurl, Voronoi, smoothing, and voxelize. Apply them to the whole model or one region, declared in code so they're never baked in.
- **Engrave / emboss** text and images, and an **image → relief** wizard for printable tiles, keychains, and stepped reliefs.
- Viewport material presets (brass, glass…) and studio lighting.

**Import & export**
- **Export:** 3MF (multi-color, multi-plate, with Bambu Studio / OrcaSlicer project files for your exact printer), STL, OBJ, GLB, STEP, VOX, and turntable / exploded-view videos.
- **Import:** STL, 3MF (with filament colours, plates, and named parts from Bambu Studio, OrcaSlicer, or PrusaSlicer), STEP, SVG, MagicaVoxel `.vox`, images (as reliefs or voxel art), sessions, and files from a URL.

**Workflow**
- **Sessions & versions:** every save is a version. Compare them side by side in a gallery or diff view, keep notes, and attach reference images.
- **Analysis:** cross-sections, a measure tool, dimensions, and a printability indicator.
- **Share links** encode the whole design in the URL hash (gzipped, client-side, nothing uploaded). Opening one shows a read-only preview, and the shared code never runs until the viewer chooses to fork it.
- Command palette (⌘K / Ctrl+K), keyboard shortcuts, light/dark themes, and a mobile-friendly layout.

**Private by design:** a static site with no backend. Geometry runs in WebAssembly in your browser, and your work is saved in your browser's IndexedDB. Model code runs in a locked-down Worker with no network or storage access, and an opt-in sandbox can move it to a separate origin. See [SECURITY.md](SECURITY.md).

## Feedback & support

Partwright is live at [www.partwrightstudio.com](https://www.partwrightstudio.com). To get in touch:

- **Report a bug:** [open a bug report](https://github.com/kemper/partwright/issues/new?template=bug_report.yml). In the app, the **💬 Feedback** button in the editor's top toolbar opens the same form with your version and browser already filled in.
- **Request a feature:** [open a feature request](https://github.com/kemper/partwright/issues/new?template=feature_request.yml).
- **Questions, tips, and things you've made:** [GitHub Discussions](https://github.com/kemper/partwright/discussions).
- **Chat with the community:** [join our Discord](https://discord.gg/vbUy95fP3Q) (also at [partwrightstudio.com/discord](https://www.partwrightstudio.com/discord)).
- **Security issues:** please [report them privately](https://github.com/kemper/partwright/security/advisories/new) (see [SECURITY.md](SECURITY.md)).

## Quick start

```bash
npm install
npm run dev
```

Open [http://localhost:5173/](http://localhost:5173/) for the landing page, or [http://localhost:5173/editor](http://localhost:5173/editor) to go straight to the editor (recommended for AI agents, which drive the tool via the `window.partwright` console API).

## How it works

The editor runs user code in a locked-down Web Worker. Code receives an `api` object with `Manifold`, `CrossSection`, and `setCircularSegments`, and must `return` a Manifold:

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
| Command palette | ⌘ K | Ctrl + K | Search and run any action by name. |
| Shortcut cheat sheet | ? | ? | Show every keyboard shortcut (when not typing in a field). |
| Undo | ⌘ Z | Ctrl + Z | Undo the last paint region or annotation stroke (whichever tool is active). In the code editor, its built-in undo applies. |
| Redo | ⇧ ⌘ Z | Ctrl + Shift + Z, or Ctrl + Y | Redo the last undone paint region or annotation stroke. |
| Save version | ⌘ S | Ctrl + S | Snapshot the current code, geometry, paint, and annotations as a new version. |
| Format code | ⇧ ⌥ F | Shift + Alt + F | Reformat the editor contents. |
| Find / Replace | ⌘ F / ⌘ ⌥ F | Ctrl + F / Ctrl + Alt + F | Open the code editor's find or find-and-replace panel. |
| Save notes | ⌘ Enter | Ctrl + Enter | Save the Notes textarea (when focused). |
| Close / cancel | Escape | Escape | Close the open dropdown, modal, paint/annotate panel, cross-section overlay, or exit the tour. |

Undo/redo route to whatever you're working on: paint regions while painting, annotation strokes while annotating, and the code editor's own history while editing code. Save works from anywhere.

## A note on AI costs & risk

Partwright is an experiment — a passion project exploring what happens when you put generative AI inside a browser-based 3D modeling tool. I've spent my own money building it; I'm not trying to make money from it, and I hope it brings others the same joy and curiosity it's brought me.

That said: **when you connect your own AI agent, it uses your API tokens.** AI-driven CAD is genuinely hard — the agent may iterate many times before producing good geometry (or not). There are some guardrails in place to help limit runaway spend, but there's no guarantee they work perfectly in every situation. **By connecting your own AI agent, you accept responsibility for any API costs incurred, regardless of output quality.** Start small, run a quick test first, and go in eyes open.

## AI Agent Setup

### Built-in assistant (no setup beyond a key)

Click **✦ Use AI** in the editor toolbar, pick a provider, and paste your API key, or choose **Run a local model in your browser** to download a WebGPU model instead. The chat panel docks on the right. Keys are stored in your browser's IndexedDB and every request goes directly from your browser to the provider. See the in-app [Help page](https://www.partwrightstudio.com/help) for the full tour of providers, toggles, and spend caps.

### External agents

External AI agents (Claude Code, etc.) can also drive the app via `window.partwright` in the browser. The legacy `window.mainifold` alias still works for older prompts and tools. There are several ways to give an AI agent browser access:

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

Whichever option you use, the AI agent navigates to the editor (`https://www.partwrightstudio.com/editor`, or `http://localhost:5173/editor` for a local dev server), then uses the `window.partwright` console API to create sessions, write geometry code, validate results with assertions, save versions, and hand you a gallery URL for review.

See [`public/ai.md`](public/ai.md) (served at `/ai.md`) for the full API reference and recommended iteration patterns.

CLI agents working in a clone of this repo can also use the headless tools: `npm run model:preview -- <file.js>` renders a model snippet and prints its stats in about two seconds, and `node bin/partwright.mjs` drives the full app from the command line. See [`docs/headless-cli.md`](docs/headless-cli.md).

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
partwright.exportSTEP()          // Download STEP (BREP sessions)
partwright.exportVOX()           // Download MagicaVoxel .vox (voxel sessions)
partwright.exportTurntable()     // Record a turntable video of the viewport

// Sessions — save/compare design iterations
await partwright.createSession("Gear variations")
await partwright.runAndSave(code, "v1 - basic")
partwright.getGalleryUrl()       // URL for gallery view

// Color regions — tag coplanar faces with a color (see /ai.md#color-regions)
partwright.paintRegion({ point: [10,0,5], normal: [0,0,1], color: [1,0,0] })
partwright.listRegions()
partwright.clearColors()

partwright.help()                // List every method with a one-line description
```

Geometry stats are also always available as JSON in `#geometry-data` for DOM scraping.

## Catalog

The [`/catalog`](https://www.partwrightstudio.com/catalog) page holds about 160 ready-made models: mechanical parts, print-in-place fidgets, figures, voxel scenes, assemblies, and more. It's searchable and filterable, and every entry opens as an editable session. Model sources live in [`examples/`](examples/) and the baked entries in [`public/catalog/`](public/catalog/).

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
3. Once validated on the staging preview, PR from `staging` → `production` to release. PRs into `main` also get pre-merge checks (build + unit + the e2e shards) via [`pr-checks.yml`](.github/workflows/pr-checks.yml), which run on every push — drafts included.

## Architecture

Static site — vanilla TypeScript + Vite (with Preact for some panels), no backend.

```
src/
  geometry/engine.ts        Engine dispatcher + Worker client
  geometry/engineWorker.ts  Worker that runs model code; lazy-loads non-default engines
  geometry/engines/         manifold-js (default), OpenSCAD, replicad (BREP), voxel
  geometry/crossSection.ts  Z-slice to SVG/polygon conversion
  renderer/viewport.ts      Three.js interactive viewport
  renderer/multiview.ts     Offscreen multi-angle render API (renderViews/renderView)
  editor/codeEditor.ts      CodeMirror editor setup
  ai/                       Built-in AI chat: providers, chat loop, tool schemas
  color/                    Paint mode, flood fill, filament palettes, region persistence
  surface/                  Surface textures (knit, fur, knurl, Voronoi, engrave, …)
  reconstruct/              Mesh → code reconstruction
  import/                   STL / STEP / SVG / VOX / image import
  export/                   GLB, STL, OBJ, 3MF (incl. Bambu projects), VOX, video
  storage/                  Sessions, versions, and IndexedDB persistence
  ui/                       Toolbar, panels, modals, command palette
```

Heavy engines load only when first used: OpenSCAD on the first SCAD run, OpenCASCADE on the first BREP use, and WebLLM on the first local-model turn.

Requires `Cross-Origin-Embedder-Policy` and `Cross-Origin-Opener-Policy` headers for SharedArrayBuffer / WASM threads (configured in `vite.config.ts`).

## Hosting details

- Production custom domain: [www.partwrightstudio.com](https://www.partwrightstudio.com), served from the `production` branch.
- Build: `npm run build` → `dist/`
- SPA routing via `_redirects`, COEP/COOP/CSP headers via `_headers`
- Set `SITE_URL` env var in Cloudflare Pages dashboard for absolute OG/canonical URLs (falls back to `CF_PAGES_URL`)

## Security

Partwright is designed to be controlled by AI agents, which means you're trusting the app not to embed hidden instructions that trick your AI into doing something harmful. See [SECURITY.md](SECURITY.md) for the full trust model, what the app can and can't do, and how to verify it yourself.

**TL;DR:** No backend, no accounts, only privacy-first anonymous analytics (Cloudflare Web Analytics — cookieless, aggregate, never sees your designs), no hidden DOM instructions, well-known open-source dependencies, and a Content Security Policy that blocks external scripts.

## Coordinate system

Right-handed, Z-up. The XY plane is the ground, Z points up. Units are arbitrary — use consistent scale.

## License

Partwright is **source-available** under the [PolyForm Noncommercial License 1.0.0](./LICENSE). It is **free for non-commercial use**. Commercial use is not permitted under this license — commercial rights are reserved by the copyright holder. See [LICENSE](./LICENSE) for the full terms.
