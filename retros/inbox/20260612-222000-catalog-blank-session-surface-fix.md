---
date: "2026-06-12T22:20:00Z"
task: "fix: catalog models with api.surface.* ops open as blank starters"
pr: 635
areas: [surface, catalog, tooling, agents]
cost: high
---

## Liked / Worked

- The `skipSurface` opt already existed on `runCodeSync` from earlier work — threading
  it through one more callsite was a surgical one-line fix once the root cause was clear.
- `model:preview` on the D20 `.js` snippet gave instant visual + stat feedback on the
  carved-number geometry without requiring a browser round-trip.
- The prompt log hook (`promptlog-guard.sh`) caught a commit where the log wasn't staged
  yet (the Write and git-add ran in parallel, so the file existed but wasn't staged).

## Lacked

- **The root cause took many turns to locate.** The symptom (4 specific models → blank
  starters) was clear but the causal chain was subtle: `applySurfaceTextures` swallows
  its own errors and never re-throws, so the import doesn't fail — it hangs indefinitely.
  Nothing in CLAUDE.md or the surface code comments calls this out. A comment on
  `applySurfaceTextures` noting "this never re-throws — callers that need fail-fast must
  add a timeout" would have saved ~6 turns.
- **Two separate `runCodeSync` call sites needed `skipSurface`** — the thumbnail callback
  and `loadVersionIntoEditor`. I identified the thumbnail one first (correct but
  insufficient), then had to re-investigate when models still failed. The two sites are
  ~3000 lines apart with no obvious link. (cost: ~5 turns)
- **Playwright tests against the deployed Cloudflare URL** were suggested but not wired —
  `playwright.config.ts` hardcodes `localhost:5173`. We tested locally, which was correct,
  but an env-var baseURL override (`BASE_URL=https://...`) would let CI-equivalent checks
  run against the real preview.

## Learned

- `loadCatalogFileIntoEditor` wraps `importSessionPayload` in a try/catch that seeds a
  blank starter on ANY exception. But `importSessionPayload` hangs (doesn't throw) when
  `applySurfaceTextures` blocks — so the catch never fires. The blank-starter fallback
  masks hangs as "graceful degradation."
- `applySurfaceTextures` (in `main.ts`) catches surface Worker failures internally via
  `parkSurfaceChain` + toast and returns without re-throwing. This is correct for
  interactive use (no red-screen crashes) but dangerous for import paths that await it.
- The distinction between models with `api.surface.*` calls and those without was the
  exact discriminator for which models blanked — useful for future triage of similar bugs.

## Longed for

- **A `skipSurface` integration test for catalog import.** A unit/e2e test that imports
  a catalog entry with a mocked surface chain and asserts the session opens (not a
  blank starter) would have caught this regression immediately, and would prevent any
  future `loadVersionIntoEditor` caller from accidentally dropping `skipSurface`.
- **A dev-mode hang detector.** If `applySurfaceTextures` has been running for >10s during
  import (not interactive), it should log a warning or time out so the failure is visible
  rather than silent. Even a `console.warn("surface Worker still running after 10s during
  import — did you forget skipSurface?")` would have surfaced this in the very first run.
- **`baseURL` env-var passthrough in `playwright.config.ts`.** `process.env.BASE_URL ||
  'http://localhost:5173'` would let targeted Playwright runs aim at the Cloudflare
  preview without modifying config files.
