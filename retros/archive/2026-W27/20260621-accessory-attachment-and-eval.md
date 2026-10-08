---
date: 2026-06-21
session: accessory attachment system + eval loop adoption
---

## Liked
- Parallel `model-sculpt` subagents owned the per-item render→iterate loop in their
  own contexts and returned text + a final PNG — kept image tokens out of the main
  thread while still producing 6 reviewable accessories.
- The merged smooth/AA/lit rasterizer was a one-merge quality jump: re-baselining
  on it lifted scores with zero model changes (glasses 38→58, belt 8→38).

## Lacked
- The in-container Claude judge didn't work out of the box: the `@image` mention
  prompted for Read permission (→ "did not return JSON" or a hallucinated "blank
  model"), and `--dangerously-skip-permissions` is refused under root. Fix:
  `--allowedTools "Read"`.
- The eval contact sheet downscaled the candidate to ~192px/tile, so fine
  accessories were invisible to the judge before any geometry mattered.
- The eval judge still can't fairly score **full-figure** accessories (belt/sword/
  cuirass) — the part is a tiny fraction of the frame, so a clear cuirass
  improvement didn't move the score at all.

## Learned
- Thin accessory features (glasses temples, chains, blades) fragment on the coarse
  march AND get frayed by the `detail` refine pass — route them to HUG the body
  surface, keep them ≳1.3× edgeLength, and prefer a finer global edge over a refine
  sphere. Print-chunky is the right default.
- "Frame the eval case to its subject": a face accessory must render head-only or
  it's unreadable; this is now in `evals/README.md`.
- Camera convention gotcha: in the rasterizer `--view 0` is the RIGHT side; front
  is `az -90` (named views), which silently wasted a couple of render passes.
- `componentCount`/the eval judge are tools with blind spots — verify with your own
  high-res eyes when the automated signal contradicts what you can see.

## Longed for
- A per-case **focus/zoom tile** in the eval harness so worn/held accessories are
  rendered close enough for the judge to assess — the single change that would
  unlock eval-driven QC for the majority of parts.
- The eval comparing against true app-**color** renders (the warm `daemon render`
  path) instead of grey normals, so real-photo references judge fairly.
- A general per-region fine-march (the `__fineHands` mechanism generalized) so thin
  parts needn't be print-chunky to survive meshing.
