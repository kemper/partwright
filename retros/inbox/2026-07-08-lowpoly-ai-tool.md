---
date: 2026-07-08
author: claude (opus-4-8)
task: api.lowPoly in-code low-poly / faceted crystallizer + guidance fix (PR #917)
---

## Liked
- Four parallel `explore` subagents up front turned a vague two-idea brief into a precise build plan in one round: they surfaced that (a) the decimation engine already existed (`simplify.ts`, UI-only), (b) the renderer already flat-shades coloured meshes (unindexed → face normals), and (c) the real bug was a *system-prompt* line routing "low-poly" into primitive soup — not a missing feature. Each of those would have been a slow solo discovery.
- The exploration reframed the task: two feature ideas collapsed onto ONE primitive (coarse mesh + flat shade), so I shipped a single `api.lowPoly` that serves both the photo→creature and the import→low-poly paths, plus deferred the vertex-pushing engine instead of building it.
- The in-app before/after screenshot (27,242 → 500 tris, same silhouette) was the decisive proof — the whole feature hinges on the "de-indexed when flatShade" render path, and seeing it faceted in the real viewport (not model:preview, which smooth-shades) confirmed it in one look.

## Lacked
- `model:preview`'s PNG is smooth-shaded, so it can't show the low-poly facet look at all — the ONLY way to verify the defining visual was a full Playwright spec + app screenshot. A headless render path that honours `flatShade` (or exposes it) would let CLI agents QC faceting without booting the browser.
- No typed link between "new sandbox `api.*` helper" and the parity surfaces (modifier/`window.partwright`/AI tool). I had to reason out that a modeling primitive belongs on `api.*` only, while a "bake the current model" action needs the full parity set — the capability-registry gap CLAUDE.md already flags.

## Learned
- The renderer flat-shades any mesh with `triColors` purely as a side effect of unindexing for per-triangle colour (viewport.ts:821-864). So "low-poly faceted shading" needed no new material — just extend that unindexed branch to an unpainted `mesh.flatShade` mesh. Worth checking for an existing side-effect path before building a "new" render mode.
- A per-run, non-persisted render flag (`renderOnly`) is the right template for anything derived from code that must survive reload without a schema bump — `flatShade` rode the same pattern (re-derived each run) and touched zero persistence code.
- Sandbox user code runs synchronously (`new Function('api', code)(api)`), so an `api.*` helper can't be async — the off-thread `simplifyToTriangleBudget` needed a pure *synchronous* sibling (`lowPolyOp.ts`) rather than reuse.

## Longed for
- A `flatShade`-aware headless preview (see Lacked) — the single biggest lever for iterating low-poly geometry from the CLI.
- A one-shot "expose this capability at parity" scaffold: given a new `api.*`/UI action, stub the modifier + `window.partwright` method + AI tool + help entry + doc so the parity rule is mechanical instead of remembered.
