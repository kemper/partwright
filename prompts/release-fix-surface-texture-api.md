---
date: 2026-06-12
branch: claude/elegant-turing-sjwiei-surface-api
files_changed:
  - src/main.ts
  - src/ai/tools.ts
---

## Human

Pre-production-release review of `main` (543 commits since `production`). Find
and fix critical defects from the recent merge window before cutting the
release. Multiple review subagents scanned the diff across categories.

## Assistant

This PR fixes two real surface-texture API bugs surfaced by the review:

1. **CRITICAL — `applySurfaceTexture` rejected the scope opts it advertises.**
   The documented "best path" wrapper (and the AI chat tool) is supposed to
   accept `label:'name'` / `region:{point,radius}` to scope a texture, but its
   `assertNoUnknownKeys` allow-list only included the per-modifier fields plus
   `preserveColor` — so `{label:'grip'}` returned `{error:"unknown key 'label'"}`
   before ever reaching `applySurfaceTextureAsCode` (which *does* resolve scopes
   via `parseSurfaceOpts`). The `opts` type also structurally forbade the
   `region` object. Fix: widen `opts` to `Record<string, unknown>`, add
   `SURFACE_SCOPE_KEYS` to the allow-list, split the scope out, pass it to the
   code path, and return a clear error (instead of silently texturing the whole
   model) when a scope is given on a bake-only session. This also gives the
   previously-dead `SURFACE_SCOPE_KEYS` export a real importer.

2. **HIGH — knurl `profile` (round vs pyramid) was silently dropped on the bake
   path.** `buildSurfaceModifier` hand-lists each modifier's fields and never
   read `opts.profile`, so the Surface panel's "Pyramid" choice always baked
   round bumps and there was no API/help way to bake a pyramid knurl. The
   in-code `api.surface.knurl({profile})` path already worked (it spreads
   defaults+opts), so the two paths had drifted. Fix: thread `profile` into the
   bake builder, add it to `applyKnurlTexture`'s opts type and the `help()`
   signature.

Also fixed the doc/cast drift these touched: `previewSurfaceModifier`'s JSDoc +
`help()` id list (missing `knurl`/`engrave`), and the `applySurfaceTexture`
dispatch cast in `tools.ts` (missing `knurl`).

Verified: typecheck + 1264 unit tests pass; a browser probe confirmed both
scoped (`label`/`region`) calls and a `profile:'pyramid'` knurl now return
`ok:true` with the scope/profile preserved in the generated code.
