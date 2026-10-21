---
date: 2026-06-21
author: claude (opus-4-8)
task: Fix buried unpainted triangle from edge-smoothing paint (PR #815)
---

## Liked
- Refusing to blind-patch a subtle, heavily-tested geometry pipeline. Four synthetic reproductions (flat grid, huge tri, tilted face, grazing contour, concave two-lobe) all behaved correctly, so instead of guessing I asked the user for the `.partwright.json`. The real session reproduced the exact defect in one run — the right call over a speculative change.
- `vite-node` + `manifoldJsEngine.run()` as a faithful headless oracle: I could replay the user's real strokes against the real meshed model outside the browser and get the buried triangle's exact field values (verts `-0.24/-0.50/-0.50`, centroid `+0.19`) — that one measurement pinned the root cause (concave footprint: vertices in, interior out) with no theorizing.
- The before/after colored render via `renderViews({angles})` written straight to a PNG made the fix self-evident to the user without UI chrome.

## Lacked
- A pure-unit-tier home for the regression. The bug needs the engine's real meshed pyramid (geodesic field + slab normals depend on the actual mesh structure / merge arrays) — my hand-reconstructed 5-vert mesh refused to refine (6 tris out), so the faithful test had to go to the e2e tier as an in-page `import('/src/...')` + `manifoldJsEngine.init()`. Fine, but it means a ~4s browser test guards a pure-geometry fix.
- Knowing up front that `model:preview` shades by normal and can't show paint colors — I reached for `renderViews` (which DOES apply triColors) only after, the bake-vs-preview color note in CLAUDE.md is the thing to internalize.

## Learned
- "All 3 vertices inside the footprint" ≠ "triangle is inside" whenever the footprint is concave (any looping/curved brush stroke is). `brushClassifier` trusted vertex signs to skip subdivision, but paint resolves by centroid — the two disagree on a coarse triangle spanning the concave side, leaving it big AND unpainted. The fix mirrors the interior-sampling `selectByClassify` already does for its straight-boundary test.
- Pathologically coarse models (`Manifold.cylinder(h,r,0,4)` = 6 triangles, one giant tri per face) are the stress case for localized paint refinement — most paint bugs that "only happen sometimes" want a low-poly face under the brush.

## Longed for
- A headless paint-QC harness (like `figure:smoke` for labels) that takes a model + stroke descriptors and reports "N triangles fully inside a footprint yet unpainted, largest edge X" — exactly the assertion my regression makes by hand. It would have caught this class in the fast loop instead of needing a user screenshot.
