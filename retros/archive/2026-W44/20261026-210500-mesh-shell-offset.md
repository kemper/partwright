---
date: "2026-10-26T21:05:00Z"
task: "feat: add api.shell and api.offset for any mesh"
pr: 1145
areas: [tooling, testing, agents, import-export]
cost: low
---

## Liked / Worked
- Unit tests can load real manifold-3d (`tests/unit/manifoldFacts.test.ts`
  pattern), so geometry ops get numeric checks (volume, sealed cavity, bbox)
  in about 1 s, with no browser.
- An independent `work-reviewer` pass caught a real correctness bug I had
  missed. The exact-distance band was chosen from the occupancy raster, which
  can't see fins or slots narrower than a voxel. It came with concrete repro
  numbers, and I turned them straight into failing tests.
- The `explore` audit mapped all seven feedback items to existing code
  (file:line) in one pass, which made the tracking issue accurate on the
  first try.

## Lacked
- A user-shared Google Drive STL (47 MB, private) couldn't be fetched. The
  Drive connector returns base64 into context and a direct curl hits
  sign-in. I tested on a synthetic head instead. (cost: ~3 turns)
- Running many manifold ops in one vitest test without `.delete()` exhausts
  WASM memory and surfaces as a misleading "too small to resolve" result. I
  briefly misread the limit table because of it. (cost: ~2 turns)

## Learned
- `signedFieldFromOccupancy` underestimates nothing on well-resolved
  geometry, but it is blind to any feature thinner than one voxel. Any
  lattice op that picks its exact-distance band from the raster has this
  hole; selecting by `markTriangleSamples` + `edt3dSquared` (as `nearScope`
  does) avoids it.
- vitest only prints `console.log` from passing tests with
  `--reporter=verbose`.

## Longed for
- A connector-to-disk download (Drive file → local path) so large user
  assets reach the container without passing through the context window.
- An `npm run probe -- snippet.ts` that runs a TS snippet against real
  manifold-3d with a fresh module per call, without hand-writing a
  throwaway vitest file each time.
