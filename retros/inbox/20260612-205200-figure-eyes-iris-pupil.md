---
date: "2026-06-12T20:52:00Z"
task: "feat: round figure eyes with painted-on, smooth iris & pupil"
pr: 637
areas: [renderer, surface, tooling, docs]
cost: medium
---

## Liked / Worked
- `npm run model:preview` + `api.paint.label(...)` was the whole verification
  loop for this task: the `paintOps` triangle-count block let me *prove* the
  iris/pupil labels survived meshing (the issue's stated hypothesis was wrong)
  without ever opening a browser. Disproving "they don't survive meshing" took
  one render.
- The stamped-unique PNG path per `model:preview` run meant the Read tool never
  served a stale eye render across ~20 iterations.
- Delegating the first visual proportion sweep to the `model-sculpt` subagent
  kept ~40 preview PNGs out of my context; it returned only the winning numbers.

## Lacked
- `SdfNode.rotate` takes **degrees**, not radians — I passed `Math.PI/2` and the
  masking cylinder stayed vertical, painting the eyeball's poles instead of the
  front. Cost ~2 turns to diagnose from the render. The unit isn't obvious at the
  call site and there's no lint for "suspiciously small rotate arg".
- Rebaking catalog figures needs `xvfb-run` in this container (the bake launches
  a *headed* browser for WebGL); `build-catalog-entry.cjs` just dies with a
  cryptic "Target page closed / Missing X server" otherwise. Not written down —
  cost a failed bake + rediscovery.
- The figure triangle budget (~200k) is advisory and only surfaced in
  `model:preview` warnings, not in `lint:catalog` (which gates on file-size KB).
  I over-baked all figures once (strongman 232k) before realizing nothing would
  flag it; had to do a cost-tuning pass + full re-rebake (~15 min each round, ×3).

## Learned
- SDF `.label()` regions are each marched *separately* then hard-unioned, so a
  tiny feature survives as long as a `detail` sphere covers it — the smoothness
  of a painted color boundary is purely local mesh density, and past a per-figure
  threshold the build flips from direct-fine-march to coarse+refine, which *caps*
  triangle growth (so finer eyeEdgeLength is sometimes nearly free, sometimes
  balloons — figure-dependent).
- To paint a flush disc on a round SDF sphere without a protruding bump: a deep
  plug clipped to a sphere *concentric but ~1% larger* wins the union over its
  disc with a sub-visual step. Forward-offset lenses always read as beads.

## Longed for
- `xvfb-run` auto-wrap (or a clear error) inside `build-catalog-entry.cjs` /
  `catalog-regen.cjs` when no X server is present — every web/remote agent baking
  a catalog entry will hit this.
- A `npm run rebake:figures` (or `rebake -- <ids...>`) helper that loops the
  figure set with their committed palettes — I hand-rolled a bash loop mapping
  `figure_strongman.js` → `flexing_strongman.partwright.json` + palette three
  times. The example→catalog→palette name mapping is non-obvious (strongman case).
- A cheap "triangle budget" check in `lint:catalog` (advisory, per-entry) so an
  over-baked figure is caught at commit, not after a push.
