---
date: 2026-06-12
title: Recover from stale-deploy chunk-load failures instead of spinning forever
human: kriskemper@gmail.com
prefix: fix
---

## Human

Loaded the app (the main branch deploy, main.partwright.pages.dev/editor) and saw a
loading bar forever. A new window loaded fine. The stuck tab's console showed:

- "Failed to load module script: Expected a JavaScript-or-Wasm module script but the
  server responded with a MIME type of 'text/html'."
- "Failed to fetch dynamically imported module: .../assets/main-DZLxNqfy.js"

## Assistant

### Diagnosis

Classic stale-deploy chunk mismatch. `src/entry.ts` is the only statically-loaded
module; it does `import('./main')` with no `.catch`. When a new build deploys while a
tab is open (or the tab grabbed a half-swapped asset set during the deploy window), the
page references a `main-*.js` hash the server no longer has. The hashed chunk 404s,
Cloudflare's SPA fallback (`/* /index.html 200`) serves `index.html` in its place, and
the browser rejects that as the wrong MIME type. The rejected import promise was
unhandled, and the loading splash — only removed once `main.ts` runs — spun forever.
A fresh window worked because it fetched an internally-consistent index.html + chunks.

### Fix

One-time auto hard-reload as recovery: a fresh navigation pulls the new index.html and
the chunk hashes that actually exist. Guarded by a `sessionStorage` flag so a genuinely
persistent failure (offline, chunk truly gone, or a real runtime error during module
eval) surfaces an actionable "Reload" prompt in the splash instead of an infinite
reload loop or an infinite spinner.

- New pure module `src/chunkReload.ts` holds the decision logic — `isChunkLoadError`
  (matches Chrome/Firefox/Safari dynamic-import + MIME wordings) and
  `chunkRecoveryAction` (reload once on the first chunk error, else notify). Kept pure
  so it lives in the fast unit tier (`tests/unit/chunkReload.test.ts`).
- `src/entry.ts` wires it to the real `sessionStorage`/`location`/DOM: `.catch` on the
  bundle import plus a `vite:preloadError` window listener (the dependency-preload half
  of the same failure). Only chunk-load errors auto-reload; the guard is cleared on a
  successful boot so a later deploy in a long-lived tab still earns its own one retry.
  The Reload prompt only replaces the splash on app routes — the landing route's static
  HTML stays usable, so we don't cover it.

### Verification

- Unit: 9 new tests for the detection + decision logic; full tier green (1273).
- Browser: a scratch Playwright spec intercepted `/src/main.ts` and returned
  `text/html` (mimicking the SPA fallback). Confirmed it auto-reloaded once then showed
  the Reload prompt — no infinite spinner. Also confirmed a normal `/editor` load is
  unaffected. `npm run build` green.
