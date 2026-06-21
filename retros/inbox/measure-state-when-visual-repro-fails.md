# Retro — paint underlay leak (#836/#838), buried triangle (#815)

## Liked
- Asking the user for the real `.partwright.json` cracked #815 fast — four synthetic
  repros all looked correct; the actual session reproduced the bug in one run. The
  `manifoldJsEngine.run()` + `refineMeshPipeline()` vite-node harness made it a
  ~2s loop with no browser.
- The before/after colored `renderViews` shots gave the user (and me) immediate
  visual proof.

## Lacked
- A way to reproduce the #836 "purple junk" *visually* — the reporter's session was
  lost, and in every reproduction I built the paint layer covered the whole mesh and
  hid the underlay. Six visual repros all looked clean.

## Learned
- **When a visual bug won't reproduce on screen, measure the underlying STATE
  directly.** Instead of chasing pixels, I queried `getModelRegions()[0].triangles.size`
  across successive incremental strokes and saw it collapse 6033→2372→773 — the bug
  was obvious and deterministic in the number even though no render showed it. The
  pixel is a lagging, lossy indicator; the data structure is ground truth.
- Two layers that resolve the *same* predicate by *different* mechanisms (paint
  byLabel carries `region.triangles` forward; model byLabel re-resolved from
  `currentLabelMap`) will silently diverge — and `currentLabelMap` indexing the base
  mesh while `parentToChildren` indexes the current mesh is a trap. A shared helper
  for "carry a label region across subdivision" would have prevented both.

## Longed for
- A tiny in-app debug hook to dump per-region triangle coverage vs mesh `numTri`
  (live), so this class of "region lost coverage after subdivision" bug is a glance,
  not a scripted measurement. Could be a `partwright.__regionCoverage()` diagnostic.
- A "session autosave / crash-recovery" so a lost session (the reason #836 couldn't
  be reproduced from the source) is recoverable.
