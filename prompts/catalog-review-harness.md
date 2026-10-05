---
date: 2026-10-05
branch: claude/modest-ptolemy-mls6fe
files_changed:
  - scripts/catalog-review.mjs
  - src/ai/review.ts
---

## Human

Test the (newly editable) review bot on a sample of the catalog to see whether
it would have improved it; then, once there's a harness, run it over the whole
catalog with Sonnet 5.5 as the reviewer and report back.

## Assistant

Built `scripts/catalog-review.mjs` instead of a throwaway script so the
evaluation can be rerun after the prompt or the catalog changes:

- **Fidelity over speed.** Each entry is imported into the real app (dev
  server + Playwright, the `catalog-audit.cjs` pattern) and its stored code is
  re-run. The reviewer input is then built by the app's own
  `gatherReviewContext()` / `formatReviewPrompt()` / `buildReviewSystemPrompt()`,
  so the prompt text, live stats and 4-view snapshot are exactly what an in-app
  automatic review sends. `model:preview` was used for the pilot, but it can't
  render BREP entries and doesn't apply brush-painted colour regions. The entry's
  catalog name and description stand in for the user's request.
- `formatReviewPrompt` is now exported (one word) so the harness reuses it
  instead of keeping a copy that could drift.
- `call` hits the Anthropic Messages API directly (default model
  `claude-sonnet-5-5`) when `ANTHROPIC_API_KEY` is set, and skips entries that
  already have a review. `report` tallies verdicts with the same regex as
  `parseReviewVerdict`.
