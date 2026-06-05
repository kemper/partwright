---
session: "c7e1a9"
timestamp: "2026-06-05T19:20:00Z"
tools: [explore, playwright-daemon]
---

## Human

I recently merged a feature to allow headless AI agents to use this codebase
(the `model:preview` npm command for headless modeling). I'd like a CLI agent to
have access to all the tool calls the in-app AI has, and really all the
`window.partwright` capabilities. One direction: a formal CLI (Homebrew tap)
that can headlessly do most of what the app can and return screenshots without a
browser. Should it be a stateless CLI, or should it launch a local server?
Investigate and report back. — Then: make a design doc, implement phase 1 and
phase 2, and test it by making a few new catalog objects unlike the current ones.

## Assistant

## Key decisions

**Reframed "stateless vs local server" → "where does the browser live?"** Four
parallel `explore` agents established the load-bearing facts: (1) the engine
already runs unmodified in Node via Vite SSR (`previewModel.ts`); (2) the real
screenshot path (`multiview.ts`) needs WebGL+DOM and paint/annotation state that
only exists in the browser; (3) ~67 AI tools + ~100 `window.partwright` methods
are almost all browser-coupled; (4) the incremental-modeling loop is inherently
stateful (sessions/versions/notes in IndexedDB, read every turn). Conclusion: a
pure-Node server reimplementing `window.partwright` would fork the codebase and
drift; the right "server" is a **warm headless browser running the real app**.

**Two-layer CLI (`bin/partwright.mjs`).** Phase 1 = stateless Vite-SSR engine +
the existing pure-JS rasterizer (`preview`/`run`), for the fast geometry inner
loop. Phase 2 = a long-lived daemon holding an in-process Vite dev server (real
config → COEP/COOP for WASM threads) + Playwright Chromium with a persistent
user-data-dir (IndexedDB survives) + a localhost-only control server. Commands
`call`/`render`/`bake` auto-start the daemon and reuse the warm page, so the
WASM+renderer cold start is paid once.

**Shared core, no duplication.** Extracted the rasterizer + SSR runner into
`scripts/cli/preview.mjs`; `scripts/model-preview.mjs` now delegates to it
(back-compat preserved). The daemon's `/rpc` proxies `window.partwright[m](...)`
1:1 — full parity for free because the tools already run in the page.

**`/reset` between batch entries.** `createSession` pushes browser history, which
destroyed the Playwright evaluate context on the 2nd/3rd bake. Mirrored the
proven `_catalogBake.spec.ts` per-entry `goto('/editor')` via a `/reset`
endpoint called before each bake.

**Three new catalog objects, deliberately unlike existing entries** (no
science/astronomy/stationery in the catalog): `dna-helix` (twin backbones +
colored base-pair rungs — caught a real bead-spacing weld bug via Phase 1
preview), `ringed-planet` (banded sphere + concentric ring disk welded at the
equator), `fountain-pen` (turned object from stacked tapered cylinders). All
self-colored via `api.label`, single-component, baked through the Phase 2 daemon
with real rendered thumbnails. Phase 3 (Homebrew/Chromium provisioning) is left
as documented future work in `docs/headless-cli.md`.
