---
session: "idpiob"
timestamp: "2026-06-11T20:30:00Z"
model: claude-opus-4-8
tools: [build-catalog-entry.cjs, xvfb-run]
sequence: 2
---

## Human

Follow-up to the figure-API rework (PR #599): rebake the 10 figure catalog
entries so their baked meshes/thumbnails reflect the new head-unit proportions,
sex selector, and guaranteed-coverage clothing.

## Assistant

## Key decisions

**Why all 10 need it.** Every figure example uses clothing AND a non-default
`headsTall` (3/5/7/7.5/8), so the proportion refactor (girth now in head-units)
and the clothing coverage underlayer change all of their geometry. The previous
bakes were frozen against the old code.

**Branch is stacked on the figure branch.** A correct rebake requires the NEW
figure code, so this branch is based on `claude/figure-api-research-idpiob`, not
`main`. The PR targets `main` and should merge AFTER #599; until then its diff
shows the figure code too (standard stacked-PR flow — the diff collapses to
bake-only once #599 lands).

**Bake pipeline (same as the prior rebake).** `scripts/build-catalog-entry.cjs`
drives a headed sandbox Chromium for real WebGL, so it needs `xvfb-run` + a
running dev server. Each entry baked with its committed palette
(`public/catalog/palettes/<id>.json`) and `--require-labels` (all palette labels)
so a buried/aliased-away painted region fails the bake. The `.thumb.png` sidecars
are untracked inspection artifacts (the real thumbnail embeds in the JSON), so
they are not committed.

**Results.** All 10 baked clean: `isManifold: true`, `componentCount: 1`, every
palette label resolved. Genus: most 0–2; karate is genus 4 (its deep front
stance + bent arm near the torso + belt + the new gi coverage layer add a few
handles) — inspected the thumbnail and the gi covers cleanly with the pose
intact, so the handles are legitimate topology, not a self-intersection defect.
Did NOT re-add per-figure `--max-genus` gates this round (the new genus values
differ from the prior bake); the label gates plus manifold/component assertions
caught regressions, and the thumbnails were inspected directly.
