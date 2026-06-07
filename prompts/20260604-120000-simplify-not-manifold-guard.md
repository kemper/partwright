---
session: "fervkel"
timestamp: "2026-06-04T12:00:00Z"
model: claude-opus-4-8
tools: [explore]
---

## Human

Sometimes after I've painted, then enhanced a model, then painted it again, I go
to the simplify menu to simplify it and I get an error "model is not manifold"
but I've done nothing that would make it non-manifold. I also don't see any
warning that I have a non manifold model. Can you investigate? I'm using the
starter manifold-js model to test.

## Assistant

## Key decisions

**Root cause**: `applyLiveGeometry()` in `src/main.ts` (the helper that swaps in
new geometry after a simplify/enhance) rebuilt the queryable Manifold with
`mod.Manifold.ofMesh(mesh)` **without a try/catch**. The normal post-code-run
path (`runCodeSync`, ~line 11610) does the identical call but wraps it and falls
back to `currentManifold = null` on failure. A simplify/enhance result — or a
paint-subdivided mesh fed into it — can come back not-quite-manifold (degenerate
tris, non-2-manifold edges), so `ofMesh` throws "Not manifold". Because
`applyLiveGeometry` was unguarded, that exception escaped: the simplify UI's
catch surfaced a raw `Simplify failed: Not manifold` (the user's "model is not
manifold"), AND the exception aborted the helper *before* `updateGeometryData()`
and `syncClipSliderBounds()` ran — so the stats/printability surfaces never
refreshed and the user got no warning (their second complaint).

**Fix**: Mirror the proven post-run guard inside `applyLiveGeometry` — wrap
`ofMesh` in try/catch, fall back to `currentManifold = null`, and additionally
emit a `showToast(..., { variant: 'warn', source: 'engine' })`. The toast (a)
only fires when `ofMesh` genuinely throws, i.e. the mesh really is non-manifold,
so it's correct for every caller of the helper; (b) gives the honest warning the
user was missing — a bare `null` manifold otherwise produces the misleading
"render-only import — unverified" stats message (meant for never-measured
imports, not a failed measurement); and (c) auto-logs to the Diagnostic Log per
the single-messaging-system rule. Chose the in-helper guard over fixing each
simplify/enhance call site so restore and any future caller are covered too.

**Verification**: `npm run build` (type-check) clean; existing `simplify.spec.ts`
(7 tests) still green — no happy-path regression; a scratch repro of the
paint→simplify flow confirmed the reduction applies (4,608 → 768 tris) with a
`pageerror` listener asserting no uncaught "Not manifold" error escapes.
