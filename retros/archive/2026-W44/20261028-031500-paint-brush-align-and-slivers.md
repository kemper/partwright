---
date: "2026-10-28T03:15:00Z"
task: "feat: view-aligned paint brush (new default), front faces only, sphere brush, and seam-sliver fix"
pr: 1173
areas: [paint, visual-proof, testing, review]
cost: medium
---

## Liked / Worked
- A synthetic mesh built inline in model code (`Manifold.ofMesh({vertProperties, triVerts})`
  with a seam of 0.01-wide slivers) reproduced a user's "unpaintable hairline" in
  one spec, and the same mesh became the regression test (fails without the fix).
- A/B'ing a fix by toggling its config knob (`setAppConfig('ui', 'paintBrushSliverPx', 0)`)
  in ONE session gave a before/after with identical camera and stroke, which was
  impossible to get from two separate runs.
- The work-reviewer pass found six real should-fixes (corner-only adjacency in
  the sliver catch, depth too shallow for tilted View strokes, winding reliance)
  that all my own tests had passed.

## Lacked
- My first visual proof misled the user: before/after came from two runs with
  different framing, and the model's huge fan triangles painted far outside the
  brush, so the "remaining" line looked like a failure. The user had to ask for a
  re-shoot. (cost: one round-trip with the user)
- A sub-pixel defect is invisible at normal zoom in BOTH shots, so a viewport
  screenshot can't prove the fix; I had to draw a close-up from the painted
  triangle data (SVG → sharp) by hand.
- Synthetic canvas drags dropped every move after the first unless each
  pointermove awaited a requestAnimationFrame. (cost: ~2 runs)
- `getBrush*`/`setBrush*` API setters didn't refresh the open paint panel, so
  screenshots showed stale values (now fixed in this PR).

## Learned
- The paint adjacency graph links triangles that share only a CORNER (on purpose,
  for T-junctions). Anything that grows a region along it must check for a shared
  edge itself, or a fan around one hub vertex gets pulled in whole.
- A view-aligned prism measures depth along the ray: a surface tilted θ needs
  depth r·tanθ to keep the whole circle.
- `.click()` on paint-panel buttons can be swallowed by the tour backdrop; use
  `dispatchEvent('click')` like the other paint specs.

## Longed for
- `npm run pr:screenshots -- --ab <spec> --knob section.key=before,after`: run
  one spec twice in a single page with a config knob flipped, and lay out the
  before/after pair automatically. That's the honest A/B for any change behind a
  setting.
- A `paintMap` debug helper (`partwright.debugPaintMap({center, radius, size})`)
  that renders the painted triangle sets top-down at any zoom, for sub-pixel and
  seam proofs, instead of a hand-rolled SVG.
- A shared `dragOnCanvas(page, path)` e2e helper that paces pointermoves per
  frame. Five specs each roll their own and the naive version silently drops moves.
