---
date: 2026-07-07
branch: claude/catalog-tested-versions-bbov8t
files_changed:
  - src/content/data/catalogCategories.ts
  - src/content/catalogFilter.ts
  - src/ui/catalog.ts
  - src/content/build/render.ts
  - tests/unit/catalogCategories.test.ts
  - tests/catalog.spec.ts
---

## Human

Also add the ability to filter catalog entries by ones that are tested.

## Assistant

Added print status as a third filter facet, alongside the existing language and
theme pills — so it slots into the shared `catalogFilter.ts` machinery rather
than a bespoke control. A "Print status:" pill row now offers "✓ Print-tested N"
(emerald, matching the tile chip) and "Untested N" (muted); selecting one
narrows the whole catalog to that status. Empty selection = all, and the facets
AND together, exactly like the other two.

**Shared pure helpers** (`catalogCategories.ts`): `printStatusOf(printTested)`
→ 'tested' | 'untested', `printStatusCounts(entries)` for the pill counts, and
the `CATALOG_PRINT_STATUSES` def list — mirroring the `themeCounts` /
`CATALOG_THEMES` pattern so both renderers stay identical.

**Filter wiring** (`catalogFilter.ts`): each tile now carries `data-status`;
the wire loop grew a `selectedStatus` set and a `statusOk` clause, reusing the
generic `wireFacet` helper. The pill only renders when *both* statuses are
present (the same "> 1 present" rule the language pills use), so a fully-untested
catalog shows no status facet — keeping older/pre-tested branches unchanged.

Both surfaces emit the row: the in-app overlay (`catalog.ts` `buildControls`)
and the static pre-render (`render.ts` `catalogControlsHtml`).

Tests: unit coverage for `printStatusOf` / `printStatusCounts` (including the
omit-empty-status case); an e2e test that clicking the "✓ Print-tested" pill
leaves exactly the tested tiles visible and toggling it off restores the full
catalog. Verified in a real browser — the pill filters to the three tested
tiles. typecheck, unit, build, and the full 11-test catalog e2e spec all green.

Follow-up on the same PR (#905) as the tested-notes/versions work.
