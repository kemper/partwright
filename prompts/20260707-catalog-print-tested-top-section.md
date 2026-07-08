---
date: 2026-07-07
branch: claude/catalog-tested-versions-bbov8t
files_changed:
  - src/content/data/catalogCategories.ts
  - src/ui/catalog.ts
  - src/content/build/render.ts
  - tests/catalog.spec.ts
---

## Human

Can we also prioritize showing tested models at the top of the catalog? Also
show them where they belong down below, but I want a tested section to show
first up top.

## Assistant

Added a "Print-Tested" showcase section pinned to the very top of the catalog,
listing every verified model — and left each one in its normal engine/curated
category below too (additive, not a move). So a tested entry now appears twice:
once in the top showcase and once in its home section.

**Why additive, not a new bucket.** The existing categories are mutually
exclusive (each entry lands in exactly one via `categorizeOf`). Print-Tested is
different — it's a cross-cutting showcase that intentionally duplicates, so I
kept the bucketing untouched and just rendered an extra section from
`entries.filter(printTested)` before the category loop. `PRINT_TESTED_SECTION`
(a plain `{id,title,blurb}`, id `'print-tested'` — deliberately NOT a
`CategoryId`, since it never buckets) lives in the shared `catalogCategories.ts`
so both surfaces render it identically. It renders only when ≥1 tested entry
exists.

Both renderers: in-app `catalog.ts` prepends the section via the existing
`renderCategorySection` (broadened its param from `CategoryDef` to a structural
`{id,title,blurb}`); static `render.ts` got a small `sectionHtml()` helper so
the showcase and the category sections share one template, then prepends the
showcase string. The `data-category="print-tested"` section satisfies the same
filter contract, so search + the language/theme/status pills filter its tiles
too (and it hides when its tiles all filter out).

Tests: a new e2e asserting the showcase leads, holds only tested tiles, and that
a tested model (Country Manor) also appears in ≥1 section below. Updated the
three existing tests that encoded the old leading section / counts: section
count 8→9 with `print-tested` first, the "fidget-toys leads" test now checks
`nth(1)` (the first real category after the showcase), the parametric-badge
invariant now includes the showcase's duplicated parametric tiles, and the
manor tooltip locator is `.first()` (tested tiles match twice now). Verified in
the browser — the four tested models lead the page, each also present in its
category. typecheck, unit, build, and the full 12-test catalog e2e all green.

Follow-up on PR #905 (same catalog-tested branch).
