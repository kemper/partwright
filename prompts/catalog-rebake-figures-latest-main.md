---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - public/catalog/*.partwright.json (16 figure entries re-baked)
---

## Human

Can you create a new PR where you rebake more of the catalog (using the latest
main since I just merged your last PR). [then, mid-bake:] I just merged another
fix that might need a fresh latest main.

## Assistant

Refreshed 16 figure catalog entries against the latest `main` so they pick up the
recent figure-engine work (eyebrows/ears, footwear resize, the conformal
marking/recess helpers, and the just-merged runway-gown topless-cone fix). These
are the figure entries NOT already refreshed by the areola PR (#713) — all 15
`figure_*` entries in `bake-manifest.json` except the already-fresh swimmer and
strongman, plus `expectant_mother` (whose brows #741 improved via `on: skin` but
which was never baked to the catalog).

Mid-task the user merged another engine fix, so I discarded the first bake pass
(made against the prior main), merged the new `main` (427171f — a runway-gown fix
touching `sdfFigure.ts`), restarted the dev server on the new engine, and re-baked
all 16. Each baked with `--palette-from-existing` (recovers the committed palette)
and the manifest's `--require-labels` gate where defined.

Verified: typecheck clean; all 16 build `componentCount: 1`, `isManifold: true`,
labels resolving; a 16-thumbnail montage confirms every figure renders correctly
(poses, clothing, dresses) with nothing broken. `princess` (genus 6→3) and
`expectant_mother` shifted slightly — consistent with the gown fix + conformal
brows. No source or engine files changed in this PR — catalog bakes only.
