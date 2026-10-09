---
date: 2026-10-09
branch: claude/modest-ptolemy-mls6fe
files_changed:
  - public/catalog/*.partwright.json (19 entries tracked in #985)
  - examples/* sources for those entries where one exists
---

## Human

Use subagents to fix all 19 catalog entries in #985, with Sonnet 5.5 as the
subagent model, and use the review bot on each re-baked entry to make sure the
fix is done well.

## Assistant

- **Fan-out.** Sonnet fixer subagents, grouped 1–3 entries each by engine
  (SCAD, manifold mechanical, voxel, BREP, figures, textured), run in waves of
  about 4 because every bake drives its own headless Chromium against one dev
  server. Each fixer edits only its own entries' files (entry JSON +
  `examples/` source) and runs no git. Since `build-catalog-entry.cjs` never
  touches `manifest.json`, parallel bakes can't collide. Description changes
  come back in the fixer's report and the coordinator applies them to the
  manifest.
- **Fixes are proven, not eyeballed.** Every defect needs a measurement from
  `model:preview` stats, probes or close-up renders, and the fixer must look at
  the real app render from `catalog-review.mjs prepare`.
- **Independent review gate.** Each re-baked entry is graded by a separate
  Sonnet reviewer using the merged recalibrated prompt (#987), on the exact
  in-app review input. Real in-scope findings go back to the fixer.
- **Committed per entry.** Entries are committed by explicit path as each one
  completes, so in-flight fixers' half-written files are never swept in.
