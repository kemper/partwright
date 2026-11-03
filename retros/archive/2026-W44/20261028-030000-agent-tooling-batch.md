---
date: "2026-10-28T03:00:00Z"
task: "feat: model console panel, reference geometry in renders, annotated sections, thickness map"
pr: 1179
areas: [tooling, agents, renderer, ui, git-workflow]
cost: low
---

## Liked / Worked
- The `viewportRegistry` leaf note in CLAUDE.md pointed straight at the right
  pattern: a data-only `referenceMesh.ts` leaf let `multiview.ts` draw the
  ghost without importing the viewport feature layer. `lint:deps` stayed
  clean on the first try.
- Real manifold-3d in vitest plus three-mesh-bvh in Node made the thickness
  map unit-testable with exact numbers (a 1-unit hollow box measures 1.000
  everywhere).
- An asymmetric L-shape e2e (bounding boxes per cut) pinned the section
  orientation without trusting rotation maths.

## Lacked
- This session may only push to one branch, and the user was asleep, so six
  deliverables had to share one PR. One commit per deliverable keeps it
  reviewable, but a sibling branch per item would have been cleaner.
- I wrote "try healCurrent()" for render-only imports from memory. Checking
  the code showed it returns null without a live Manifold. A doc claim about
  a recovery path should be checked before writing it, as I did here.

## Learned
- `renderSection`'s y cut came out upside down (rotate([90,0,0]) maps +Z to
  −y in the slice) and the x cut had −Z rightward. Nothing in the docs said
  so; agents reported the result as "the face is at the bottom right".
- Each section contour was a separate filled `<path>`, so holes were painted
  over. All contours in one path with `fill-rule="evenodd"` fixes it
  whatever the slicer's winding.
- The AI tool's `rasterizeSvg` forced a square canvas. Any non-square SVG was
  silently distorted.

## Longed for
- A `partwright.debugProbe(code)` that runs code isolated and returns logs,
  stats and a thumbnail in one call, since that is what agents iterate on.
- Per-item branches for multi-deliverable overnight sessions (or permission
  to create them), so each PR can merge on its own.
