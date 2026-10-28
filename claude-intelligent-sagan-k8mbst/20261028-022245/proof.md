**Re-shot as a true A/B.** Both passes ran in one session with an identical top-down camera and the identical stroke. "Before" is this branch with the new setting at 0 (the code path on `main`); "after" is the default 1.5 px. The test slab is all black, with a 1 × 0.33-unit triangle grid and a seam of 0.01-wide sliver quads down x = 0. The old screenshots came from two separate runs with different framing, which is why the edges didn't match; they also used a model with huge fan triangles that painted far outside the brush.

**What was painted, close-up of the seam** (drawn from the exact painted triangle sets, 600 px per mesh unit, seam horizontal):

![map](proof-map.png)

Across the whole stroke, the fix added 61 triangles (1910 → 1971 painted). Every one is a seam sliver under the brush.

**Viewport at normal zoom** (same camera both passes): here a 0.01-wide seam is under a fifth of a pixel and doesn't show in either shot. The close-up above is where the difference is.

| Before | After |
|---|---|
| ![before](proof-view-before.png) | ![after](proof-view-after.png) |
