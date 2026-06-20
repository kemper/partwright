# Retro — part color loss on switch / export

**Context:** A chat session that fanned out into a cluster of "parts lose their
color" bugs: paint dropped on part switch (starter code), model colors not
re-rendered on cache-hit restore, Save-all thumbnails shared/colorless, and an
"export drops color" report. Shipped PR #735 (3 fixes + a unification) and PR
#760 (export-unsaved warning); filed #736, #749, #758.

## Liked
- Reproduce-before-fix paid off twice. The headless/Playwright repro that reads
  the live three.js `color` attribute (`getMeshGroup()` → solid mesh → `color`
  BufferAttribute) gave an unambiguous pass/fail signal for "is it actually
  rendered colored", far better than `listRegions()` (which showed colors
  present while the viewport was blank).
- Reproducing the EXPORT color claim *before* coding saved building a phantom
  fix: the multi-part 3MF bake already composes colors correctly; the real cause
  was unsaved work. The "fix" became a warning, not a bake change.

## Lacked
- `loadVersionIntoEditor`'s cache-hit branch hand-rolls the run/render path
  (mesh, manifold, labels, model regions, params, AND coloring). It shipped the
  SAME class of bug twice — once for model-color render, and the latent
  mis-color flash. Filed #749 to unify it; the color half is done (rehydrate is
  now the single color authority) but the rest still duplicates.

## Learned
- Two distinct "no color" mechanisms look identical to a user: (a) regions
  dropped/never-saved, (b) regions present but the displayed mesh wasn't
  re-colored. Always check BOTH the region store and the rendered color
  attribute when triaging.
- `void seedStarter()` (fire-and-forget) made a part switch resolve before the
  starter rendered — invisible until something captured the viewport right after
  (Save-all thumbnails). Awaited side-effects matter when a caller reads state
  synchronously after.

## Longed for
- A single `applyRestoredPartState(entry)` shared by the cache-hit and
  cache-miss restore paths so per-version state can't drift (the #749 refactor).
- A test helper for "what color is actually rendered" (the `getMeshGroup` color
  sampler) promoted out of scratch specs into a shared test util — three specs
  now reimplement it.
