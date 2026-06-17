---
session: "figure-smoke-paint-oracle"
timestamp: "2026-06-16T14:00:00Z"
model: claude-opus-4-8
---

## Human

Review the latest weekly-retro PR plus the three (unmerged) catalog-baking
experiment PRs for new retro material, and decide what to fix/implement so agents
work better with this app. The catalog PRs won't be merged, but their retro
material might be valuable. After reviewing, the user chose three follow-ups:
harvest the three retro entries, implement the #1 ask, and file the missing issues.

## Assistant

## Key decisions

**Read the W26 retro PR (#696) and the three parallel "20 full-body figures"
experiment PRs (#690/#692/#693).** All three experiments independently converged
on the same #1 friction — already the highest-frequency W26 backlog item — so it
had 6+ independent agents behind it. The catalog-experiment retros live only on
unmerged branches, so the W26 retro-review never saw them.

**Harvested the three retro entries** into `retros/inbox/` (verbatim, with a
provenance comment) so the insight survives even though the catalog branches won't
merge — the next `/retro-review` will process them.

**Filed the missing issues and consolidated duplicates:**
- #697 — fast headless paint-label + weld oracle (the #1 ask; wasn't tracked).
- #698 — `smoothUnion` over a labelled node silently wipes paint labels (hit by
  all three experiments; wasn't tracked).
- Closed #676 and #678 as duplicates of #691 (same eye-burial bug, triplicated).

**Implemented the paint-label half of #697** (the highest-ROI, lowest-risk slice;
deferred the browser-faithful component count to the issue):

- **Root finding:** `model:preview`'s `stats.labels` only listed labels that had a
  *color*. Figure eyes/iris/pupil are labelled geometry whose colour is applied at
  bake time, so they were invisible headlessly — a buried eye (0 triangles) only
  surfaced at the ~75s xvfb bake. The `--require-labels` list is author-provided
  (same as `build-catalog-entry.cjs`), so the oracle just needs per-label triangle
  counts for *all* labels.
- **`src/tools/previewModel.ts`:** broadened `stats.labels` to the union of
  `labelMap` ∪ `labelColors` with `triangleCount` + `color|null`; added a
  0-triangle-label warning. Preserved the FUSED-mechanism warning's intent by
  gating it on *colored* labels (uncolored structural figure partitions share one
  welded component and would otherwise false-positive "fused" on every figure).
- **`scripts/cli/gates.mjs`:** new pure, unit-testable `checkRequireLabels`
  (mirrors `checkExpectComponents`); re-exported from `preview.mjs`.
- **`--require-labels a,b,c`** wired into `npm run model:preview`, the `partwright
  preview`/`run` binary, and a new focused **`npm run figure:smoke`** wrapper that
  prints a per-label paint-QC report and exits non-zero on a buried required label.
- Kept honest about the unsolved half: `componentCount` is still the Node SSR value
  and can under-report vs the browser bake — documented, not papered over.

**Verified:** unit test (`tests/unit/requireLabels.test.ts`) + typecheck + full
unit tier (1440) + production build all green; ran `figure:smoke` on a real figure
(`figure_ballerina` — eyes/iris/pupil now visible with counts) and a synthetic
buried-eye model (caught at 0 triangles, exit 1) across all three entry points.
