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

partwright daemon start [--app-port N] [--control-port N]
partwright daemon stop
partwright daemon status

partwright call <method> [argsJSON] [--out file.png] # any window.partwright method
partwright render [--code file.js] [--out file.png] [--views auto|tri|all|box] [-p k=v]
partwright bake <fixtureDir> [--catalog public/catalog]
```

- `preview` / `run` are **Phase 1** — stateless, no daemon, no browser.
- `call` / `render` / `bake` are **Phase 2** — they auto-start the daemon if it
  isn't already up, then reuse the warm page.

### Phase 1 commands

`preview` is the formalized `model:preview` (which still works and now delegates
here). It loads the file against the real engine via Vite SSR and prints the rich
stat block (`isManifold`, `componentCount`, per-component volumes/bboxes, genus,
edge stats, declared labels, `warnings[]`). Unless `--json` is passed it also
writes a 4-view PNG (front/right/top/iso), software-rasterized — flat shading,
model-declared label colors only. `run` is `preview --json` (stats, no PNG).

What Phase 1 **cannot** show: brush-painted vertex colors, annotations, edge
overlays, surface modifiers, anything stateful (sessions/versions). Those live in
the browser — reach for Phase 2.

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

`render` is a convenience wrapper: optionally `setActiveLanguage` + run a code
file, then `renderViews` → PNG. `bake` drives the full catalog-entry flow
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

## Phase 3 — packaging (not yet built)

- **Homebrew tap.** The CLI is plain Node ESM; a formula can install it and a
  thin `partwright` shim. The weight is Chromium — the formula should make the
  `npx playwright install chromium` step (or system-Chrome reuse) explicit, not
  silent.
- **Dependency move.** Phase 1/2 currently lean on `vite`, `playwright`, and
  `sharp` from `devDependencies` (fine while the repo is `private`). A published
  CLI must promote the runtime-needed ones to `dependencies` or bundle them.
- **Bundle hosting.** The daemon needs the built app. Ship a versioned `dist/`
  inside the package (simplest, version-locked) rather than pointing at a
  deployed URL (drift + network dependency).
- **Optional: expose the AI chat loop.** The `executeToolFn` seam in
  `src/ai/chatLoop.ts` means the daemon could also run the in-app provider chat
  loop, letting a CLI agent delegate to it. Near-free to add; probably not what a
  tool-calling CLI agent wants day-to-day, but worth keeping in the pocket.
