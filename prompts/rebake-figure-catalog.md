---
date: 2026-06-19
branch: claude/rebake-figure-catalog-eyspgw
files_changed:
  - scripts/rebake-figure-catalog.cjs
  - public/catalog/*.partwright.json (51 figure entries)
---

## Human

Create the PR to re-bake the entire figure catalog (the deferred follow-up from
the nose/lips fix, tracked in #771), so every figure's baked geometry +
thumbnail picks up the fixed `sdfFigure.ts` nose carve and sculpted default
lips.

## Assistant

The figure examples reach the shared builder through `api.sdf.figure`, so a
catalog entry's stored `code` dispatches into the live `src/geometry/sdfFigure.ts`
at bake time — re-running it against this branch (which carries the #770 fixes)
propagates the geometry fix without touching any source.

Wrote `scripts/rebake-figure-catalog.cjs`, generalizing the proven
`rebake-shod-figures.cjs` pattern:

- **Auto-discovers** every catalog entry whose latest stored code uses the
  figure builder (`sdf.figure` / `F.rig`) — 51 entries — so the target set
  can't drift out of sync with a hard-coded list.
- **Re-bakes in place**: re-runs the entry's own `code`, replays its `byLabel`
  paint regions (all 51 use only `byLabel`) via `paintByLabels` +
  `commitWithColors`, then splices ONLY the geometry-derived fields
  (`geometryData`, `colorRegions`, `thumbnail`) back into the existing payload.
  Everything else (notes, code, session, parts) is preserved byte-for-byte, so
  the diff is just re-baked geometry + thumbnail.
- **Canonical thumbnails**: takes the thumbnail from the app's own
  `exportSession({includeThumbnails:true})` pipeline (the 500×500 hero tile
  `build-catalog-entry.cjs` produces), which also de-outliers the 14 entries
  `rebake-shod-figures.cjs` had left at 640×640.
- **Fresh page per entry**: reusing one page tears down `window.partwright`
  after the first `createSession`, so each entry boots WASM in its own page
  (the contention-free pattern). Reports manifold / component / paint-error
  flags per entry.

This is a stacked PR on #770 (it needs the `sdfFigure.ts` fix to bake against);
once #770 merges it rebases onto main to a pure catalog-data diff.
