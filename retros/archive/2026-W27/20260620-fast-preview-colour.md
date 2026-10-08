---
date: 2026-06-20
task: fast preview shows estimated model colours (PR #808)
---

## Liked
- The fast-preview feature was already cleanly factored: the coarse pass shared
  `manifoldJsEngine.run()` with the full pass, so the colour data
  (labelMap/labelColors/paintOps) was already sitting on the preview result —
  the change was pure wiring across the worker→engine→main boundary.
- `resolvePaintOps` (the pure resolver `model:preview` uses) existed and covers
  exactly the api.paint.* descriptor kinds, so the preview colouring didn't need
  to touch main.ts's adjacency/global-state resolver. DRY win, off-state-safe.

## Lacked
- No stable way to observe the LIVE viewport's mesh colours from a test. The
  viewport mesh (`currentMeshData` + baked triColors) isn't exposed, and
  `renderViews()` recomposes from global region state (empty during the
  off-state preview), so it shows grey even when the viewport is coloured. That
  mismatch cost a couple of confused iterations.

## Learned
- The fast-preview pill is transient and the full render can replace it in
  <1 round of Playwright's ~700ms locator poll cadence — so a `waitFor` on the
  pill misses it. Two fixes: (a) inside `page.evaluate`, fire `partwright.run`
  WITHOUT awaiting and poll at ~8ms for the pill/state, or (b) use a fine
  `edgeLength` to make the FULL pass slow so the preview window is seconds wide.
- `partwright.run(code)` does NOT double-run: `setValue` cancels the debounced
  auto-run it would otherwise trigger, so there's no generation race from run().
- Playwright `page.screenshot()` DOES capture the WebGL canvas (no
  `preserveDrawingBuffer` needed) — a hue-based pixel test (dominant channel
  never inverts under shading) is a robust, non-flaky colour assertion.

## Longed for
- A tiny, sanctioned test accessor for "the colours currently on the live
  viewport mesh" (painted-triangle count / dominant colours), following the
  existing `__testGetHistoryLength` export pattern. Would turn fragile
  screenshot-pixel assertions into deterministic ones for any colour feature.
