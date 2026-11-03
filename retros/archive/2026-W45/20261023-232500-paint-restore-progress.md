---
date: "2026-10-23T23:25:00Z"
task: "fix: show real progress when restoring paint and stop idle freezes on big meshes"
pr: 1082
areas: [paint, performance, testing]
cost: medium
---

## Liked
- A CDP `Profiler` in a throwaway Playwright spec (self time + caller chains) found the real culprit in one run: paint mode's idle `buildAdjacency` pre-warm, not the worker refine everyone suspected.
- The independent `work-reviewer` pass caught a quadratic hash before it shipped.

## Lacked
- No copy of the user's 40 MB file. I had to build a synthetic repro (dense sphere + cloned `brushStroke` descriptors spliced into an exported session).
- Playwright wipes `test-results/` on every run, so repro fixtures and screenshots kept there disappeared. I moved them to the scratchpad.

## Learned
- Hashing Float32 bit patterns: grid-aligned coordinates (voxels, integer CAD, mm STLs) have all-zero low mantissa bits, so `Math.imul(x, k) & mask` collapses them into a few slots. Always avalanche-mix before masking. Random-coordinate tests (a sphere) won't show it; test with an integer grid.
- `updatePaintMesh` pre-warms adjacency on idle after every mesh change, even with paint mode off, so anything slow in `buildAdjacency` freezes every large model.
- `pr:screenshots` uploaded at the same second the PR's visual-proof workflow ran, so the run missed the upload. A dispatch from a cloud session is a 403, so the comment waits for the next push.

## Longed for
- `npm run perf:profile -- <spec>`: run a spec under the CDP sampling profiler and print the top main-thread self times and caller chains, plus longtask totals. I hand-wrote this; it is the right first step for any "the page freezes" report.
- A checked-in "heavy painted session" generator, so paint-restore performance can be measured against a stable fixture.
