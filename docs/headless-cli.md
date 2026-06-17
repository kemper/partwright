# Headless Partwright CLI — design & reference

> Status: Phase 1 + Phase 2 implemented (`bin/partwright.mjs`). Phase 3 (Homebrew
> tap / Chromium provisioning) is future work, sketched at the end.

This doc covers the `partwright` CLI: a headless way to drive the Partwright
engine and the full app **from the command line**, for CLI agents (and humans)
who want the modeling + feedback loop without clicking around a browser. It is
the CLI-audience companion to `public/ai.md` (the in-browser agent's reference).

## Why this exists

The merged `model:preview` command proved that the **real `manifold-js` engine
runs unmodified in Node** (via Vite SSR — see `src/tools/previewModel.ts`). That
gives a CLI agent fast "does my snippet run? what are the stats? what does it
roughly look like?" feedback with no browser.

But the engine is only a slice of what the app does. The in-app AI has ~67 tool
calls and `window.partwright` exposes ~100 methods — paint, real WebGL renders,
surface modifiers, sessions/versions/notes, import/export. **Almost all of that
is browser-coupled by design**, and the incremental-modeling workflow is
**inherently stateful** (every turn reads version history + session notes from
IndexedDB). So a pure-Node CLI can never reach parity, and reimplementing
`window.partwright` in Node would fork the codebase and guarantee drift.

The resolution is a **two-layer CLI**:

| Layer | Backed by | Gives you | Cost |
|---|---|---|---|
| **Phase 1 — stateless** | Vite SSR + the real engine in Node | run code, rich stats, a fast 4-view PNG (software-rasterized) | ~2 s, no browser |
| **Phase 2 — daemon** | a long-lived headless Chromium running the **real app** | the full `window.partwright` surface: paint, real renders, sessions/versions/notes, import/export — at full fidelity | ~one warm-up, then fast |

The key idea for Phase 2: the "local server" is **not** hand-written Node — it's
a warm headless browser running your actual bundle, fronted by a thin local
control server. One source of truth (the app), full fidelity, full tool parity,
and the painful WASM+renderer warm-up is paid **once** and amortized across every
subsequent call.

## CLI surface

```
partwright preview <file.js> [--png out.png] [--json] [--size N] [-p k=v ...]
partwright run     <file.js> [-p k=v ...]            # stats JSON only, no PNG

partwright preview <file.js> [--lang manifold-js|voxel|scad] [--png out] [--json] [--size N]
                   [--view az,el] [--views front,right,top,bottom,left,back,iso]
                   [--explain-components] [--expect-components N] [--require-labels a,b,c] [-p k=v]
partwright compare <a.js> <b.js> [more.js ...] [--png out] [--size N] [--view az,el] [-p k=v]  # one tile per model
partwright photo <image> [--palette p.json] [--max N] [--mode billboard|heightmap] [--depth N] [--bg] [--crop x,y,w,h] [--out model.js] [--png out]
partwright fetch <url> [--out file]                  # download a remote image to disk (for `photo`)

partwright daemon start [--app-port N] [--control-port N]
partwright daemon stop
partwright daemon status

partwright iterate <file.js> [--out png] [--views all] [--lang L] [-p k=v]  # run → stats+warnings+real render
partwright call <method> [argsJSON] [--out file.png] # any window.partwright method
partwright methods [filter]                          # list callable methods
partwright render [--code file.js] [--out file.png] [--views auto|tri|all|box] [-p k=v]
partwright bake <fixtureDir> [--catalog public/catalog]

partwright help                                      # usage (also --help / -h)
```

- `preview` / `run` are **Phase 1** — stateless, no daemon, no browser.
- `iterate` / `call` / `methods` / `render` / `bake` are **Phase 2** — they
  auto-start the daemon if it isn't already up, then reuse the warm page.

### Agent quickstart

The fastest agent loop is **draft a snippet → `iterate` → read stats+image →
fix → repeat**:

```
partwright iterate part.js            # writes part.iterate.png, prints {stats, png}
```

`stats` carries `isManifold`, `componentCount`, `volume`, `bbox`, `printability`,
and a `warnings[]` array of actionable hints (fused parts, sub-extrusion detail,
extreme aspect ratio, …) — everything needed to self-correct — and the PNG is a
real multi-view WebGL render. For a sub-second check with no browser, use
`preview` (software render) instead. Discover the rest of the surface with
`partwright methods paint` (or any filter) and reach for `call <method>` for
anything `iterate`/`render` don't wrap. Every command prints a single JSON object
to stdout (`{ ok: true, … }` or `{ ok: false, error }`); a non-zero exit means
the CLI itself failed, while `ok:false` is a tractable in-model error.

### Phase 1 commands

`preview` is the formalized `model:preview` (which still works and now delegates
here). It loads the file against the real engine via Vite SSR and prints the rich
stat block (`isManifold`, `componentCount`, per-component volumes/bboxes, genus,
edge stats, declared labels, `warnings[]`). Unless `--json` is passed it also
writes a 4-view PNG (front/right/top/iso), software-rasterized — flat shading.
Override the camera with `--view az,el` (a single custom-angle tile, to peek at
a feature the four defaults occlude) or `--views a,b,c` (pick/reorder named
angles: front,back,right,left,top,bottom,iso). `--explain-components` prints a
per-island vol/tris/size/center breakdown to stderr; `--expect-components N`
exits non-zero on a count mismatch (a CI gate for "this must stay N parts").

`stats.labels` lists **every** declared label as `{name, color, triangleCount}` —
colored *and* uncolored. A label with `triangleCount: 0` is **buried/aliased away
and paints nothing** (the trap that ships eyeless figures). `--require-labels
a,b,c` exits non-zero if any listed label resolves to 0 paintable triangles — the
fast (~2s, no browser) twin of `scripts/build-catalog-entry.cjs --require-labels`.
`npm run figure:smoke -- <file> [--require-labels …]` is a focused wrapper that
prints a per-label paint-QC report and applies the same gate. Pass only the labels
a given figure must show (closed-lid eyes legitimately paint 0). `componentCount`
is the Node SSR value and can under-report vs the browser bake for near-threshold
thin features — trust the label gate for paint, verify component splits in-browser.

The default PNG name is **stamped unique per run** (`<file>.preview-<stamp>.png`,
older stamps for the same model are cleaned up) because the agent Read tool
caches images by path — a re-render to the same name gets served stale. Take the
path from the JSON's `png` field rather than guessing it; an explicit `--png`
path is used verbatim.

**Paint-in-code resolves headlessly.** `api.paint.*` ops (box/slab/cylinder/
label) recorded by a manifold-js run are resolved against the mesh with the same
pure helpers the browser underlay uses: the PNG shows the resolved colours and
`stats.paintOps` carries per-op `{name, kind, triangleCount}` — a 0 count warns
(the region missed the surface, or names a missing label). Brush-painted
sidecar regions still need the browser.

**Voxel stats extras.** `v.sdf()` runs report `voxelRes` (the world-units-per-
voxel res, when all calls agree), `worldBBox` (mesh bbox × res — the model's
size in the SDF's world coordinates), and `sdfLabelCounts` (voxel fills per
`colors` label, **including 0-fill entries** — the smoothUnion silent-label
trap, surfaced as a warning).

**`compare`** runs several model files and tiles one view of each into a single
contact-sheet PNG — for A/B parameter sweeps or before/after checks. Each model
is fit to its own bbox; a failed variant gets a distinct pink tile. Default view
is iso; `--view az,el` changes it for all tiles.

**`fetch`** downloads a remote image (`http(s)` URL) to disk so the `photo`
voxel-import flow can consume a URL — the literal "chat-attached image" isn't
reachable from a Node CLI, so this is the URL-download equivalent. Reachability
is governed by the environment's network policy.

**Multi-engine (`--lang`).** `preview`/`run` dispatch across the engines that
run without a browser: `manifold-js` (default), `voxel` (pure-JS grid mesher),
and `scad` (OpenSCAD's Emscripten WASM loads cleanly under Node). For these the
rasterizer uses the mesh's own per-triangle colors, so voxel/painted models show
their real colors — not just label colors. `replicad` is **not** stateless: its
OpenCASCADE WASM resolves its `.wasm` to a server-style path that doesn't exist
on Node's filesystem, so preview it through the Phase-2 daemon
(`partwright iterate --lang replicad <file>`), which drives the real app.

**`photo`** turns a raster image into a palette-constrained voxel model — the CLI
front door to the same image→voxel pipeline the in-app import modal uses
(`src/import/imageToVoxel.ts`): decode + EXIF-orient + high-quality downsample
(sharp) → snap every pixel to the nearest palette colour (perceptual LAB
distance) → optional background removal → emit runnable `voxels.decode(…)` editor
code, mesh it, and write a 4-view preview PNG + stats (voxel count, dims, and a
per-slot palette-usage histogram) in one shot. `--palette p.json` takes a JSON
array of `"#rrggbb"` strings or `{name,hex}` objects; omit it for the app's
default 6-slot palette. `--mode heightmap` makes brightness drive per-column
depth (a bas-relief sculpt) instead of a flat `--depth` billboard.

What Phase 1 **cannot** show: brush-painted sidecar regions, annotations, edge
overlays, surface modifiers, anything stateful (sessions/versions). Those live in
the browser — reach for Phase 2. (Paint declared *in code* via `api.paint.*` IS
shown — see above.)

### Phase 2 commands

`call` is the universal primitive: it invokes `window.partwright[method](...args)`
in the warm page and prints the JSON result. `argsJSON` is a JSON array of the
method's arguments. Example:

```
partwright call createSession '["My Part"]'
partwright call runAndSave '["return api.Manifold.cube([10,10,10], true);", "v1"]'
partwright call renderViews '[{"views":"all","size":420}]' --out shot.png
partwright call getSessionContext
```

When a method returns a PNG data-URL (`renderView`/`renderViews`), `--out` decodes
and writes it to a file. The same persistent IndexedDB user-data-dir backs every
call, so sessions/versions/notes persist across invocations exactly as they would
in a real browser tab.

`iterate` is the high-level feedback command: it `setActiveLanguage` + `run`s the
file in the warm page, then returns `getGeometryData` (stats + warnings +
printability) **and** a real `renderViews` PNG in one call — the inner loop for
"is this good? show me," at full WebGL fidelity. `methods [filter]` enumerates
the callable `window.partwright` methods for discovery.

`render` is a thinner convenience wrapper: optionally `setActiveLanguage` + run a
code file, then `renderViews` → PNG (image only). `bake` drives the full
catalog-entry flow
(createSession → runAndSave → optional paint-by-label → save → exportSessionData
→ write `<id>.partwright.json` + manifest row), replacing the `BAKE_CATALOG=1`
Playwright spec for CLI users — same fixture format (`<id>.js` + `<id>.meta.json`).

## Architecture

```
 bin/partwright.mjs ── scripts/cli/main.mjs  (arg parse + dispatch)
        │                     │
        │  Phase 1            │  Phase 2
        ▼                     ▼
 scripts/cli/preview.mjs   scripts/cli/client.mjs ──HTTP──▶ scripts/cli/daemon.mjs
   (Vite SSR + the                                            │
    pure-JS rasterizer)                                       ├─ in-process Vite dev server (real
                                                              │   config → COEP/COOP for WASM threads)
                                                              ├─ Playwright Chromium, persistent
                                                              │   user-data-dir (IndexedDB survives)
                                                              └─ tiny localhost control server
                                                                  POST /rpc   {method,args}
                                                                  POST /eval  {body,arg}
                                                                  GET  /health
                                                                  POST /shutdown
```

**The daemon process holds three things in one Node process:** an in-process Vite
dev server (started from the project's real `vite.config.ts`, so the COEP/COOP
headers SharedArrayBuffer/WASM-threads need are served automatically), a
Playwright Chromium launched with `launchPersistentContext(userDataDir)` so
IndexedDB survives restarts, and a localhost-only HTTP control server. It is
essentially a **warm, reusable version of the Playwright spec pattern** the repo
already uses for catalog baking — except you pay the cold start once.

**State lives where it already lives.** Sessions, parts, versions (code +
geometry + thumbnails), notes, and chat transcripts persist in the browser's
IndexedDB inside `.partwright/chromium/` (the user-data-dir). No new persistence
layer, schema-identical to the app — you could open the same session in a real
browser pointed at the same profile.

**Security.** The control server binds to `127.0.0.1` only. AI API keys live in
that IndexedDB profile, so the daemon must never be exposed to the network. The
`/eval` endpoint executes a function body in the page — it is a local developer
tool, gated behind localhost, never a remote surface.

**Chromium binary** is detected the same way `playwright.config.ts` does it
(sandbox `/opt/pw-browsers/chromium-*` if present, else Playwright's own cache —
run `npx playwright install chromium` once on a fresh machine).

### State / lifecycle files (`.partwright/`, gitignored)

| Path | What |
|---|---|
| `.partwright/daemon.json` | `{ pid, controlPort, appPort, startedAt }` |
| `.partwright/daemon.log` | daemon stdout/stderr |
| `.partwright/chromium/` | persistent Chromium profile (IndexedDB lives here) |

`daemon start` spawns `bin/partwright.mjs __daemon-run` **detached** and polls
`/health` until the page reports `window.partwright` ready. `daemon stop` POSTs
`/shutdown` (falling back to SIGTERM). `call`/`render`/`bake` auto-start if no
healthy daemon is found.

## Why not the two "obvious" alternatives

- **Pure stateless Node CLI for everything.** Cheap, but a permanent
  second-class citizen: no paint, low-fidelity renders, and you'd have to
  reimplement the IndexedDB session schema in SQLite to get statefulness. Kept,
  but only as Phase 1's fast inner loop.
- **A Node server that reimplements `window.partwright`.** The literal reading of
  "launch a local server" — and the trap. You'd rebuild the renderer
  (headless-gl + DOM stubs through `multiview → annotationOverlay → viewport`),
  the paint subsystem, the session store, and 100 tool implementations in
  parallel to the real ones. Two of everything, drifting on every app change.
  Rejected.

The daemon gets full parity for free because the tools **already exist and run**
in the page it drives.

## Phase 3 — Homebrew-ready (tap-ready skeleton; distribution deferred)

The repo is now structured so a tap is a one-step flip whenever distribution is
wanted — **nothing is published today**:

- **Local install (works now).** `npm ci && npm link` exposes `partwright` on
  PATH (or run `node bin/partwright.mjs` / `npm run cli` directly). The `bin`
  field in `package.json` maps `partwright` → `bin/partwright.mjs`.
- **Formula skeleton.** `Formula/partwright.rb` is a complete node-CLI formula
  with placeholder `url`/`sha256` and a Chromium caveat. To distribute: tag a
  release, fill the tarball URL + checksum, and move the file into a tap repo
  (`homebrew-partwright/Formula/`).
- **Dependency move (done).** `vite`, `playwright`, and `sharp` were promoted
  from `devDependencies` to `dependencies` so a production install (what
  `brew install` runs, `--omit=dev`) has the CLI's runtime needs. The app build
  is unaffected (`npm ci` installs both sections regardless).

Still open for a real release (when you choose to distribute):

- **Chromium provisioning.** The formula's caveat tells the user to run
  `npx playwright install chromium`; a polished release could auto-provision it
  in a post-install step or detect a system Chrome.
- **Bundle hosting.** The daemon serves the app from the repo's source via Vite.
  A distributed CLI should ship a versioned built `dist/` (or vendor the source)
  rather than assume the repo is present.
- **Optional: expose the AI chat loop.** The `executeToolFn` seam in
  `src/ai/chatLoop.ts` means the daemon could also run the in-app provider chat
  loop, letting a CLI agent delegate to it. Near-free to add; probably not what a
  tool-calling CLI agent wants day-to-day, but worth keeping in the pocket.
