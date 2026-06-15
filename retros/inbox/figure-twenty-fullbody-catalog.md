# Retro — 20 full-body figure catalog entries (PR #690)

## Liked
- Fanning out 10 `model-sculpt` subagents (2 figures each) with feature/pose
  coverage pre-partitioned worked well: 20 varied figures authored in parallel,
  and the main context stayed clean because agents Read preview PNGs in their own
  context and returned only text + palettes.
- Baking serially as the single git writer kept git sane while agents ran.

## Lacked
- **`model:preview` can't paint, so a whole defect class was invisible until bake
  time.** Eyes/iris/pupil/lids (and open-mouth teeth/lips) silently baked to 0
  paintable triangles on round/heart faces, giant chibi heads, and pitched-back
  heads. Agents reported "passes all gates" because geometry was fine; the paint
  failures only showed when *I* baked with a palette. Cost several extra bake
  rounds and per-figure eye-push tuning. (Filed #691 for the API fix.)
- No quick "is the painted result right?" check short of a full browser bake.

## Learned
- The figure eye-push (`max(rad*0.28, r.head*0.09)`) is a fixed `0.09·head` at
  catalog radii and doesn't clear cheeky/round/huge/tilted faces — workaround is
  translating the eyes node along `rig.dir.headForward`.
- Relabel traps: `body.smoothUnion(prop).label('skin')` swallows the prop's label
  (flesh barbell); a prop must be hard-unioned with its own label (overlapping for
  one component) to paint distinctly. Same for `.label('base')` over a welded ball.
- Triangle budget is dominated by `faceDetail`/`handDetail` regions, not global
  `edgeLength` — coarsening the grid barely helped the barbell figure; dropping
  `handDetail` + mitten fists (`fingers:false`) cut it from 218k → 152k.

## Longed for
- **A `--require-labels eyes,iris,pupil,lids` (or palette-paint) gate baked into
  the authoring loop** so subagents catch buried-eye/0-triangle paint failures
  themselves instead of the orchestrator discovering them at bake time. Even a
  headless "paint these labels and report which resolved to 0 tris" mode of
  `model:preview` would have removed an entire feedback round.
