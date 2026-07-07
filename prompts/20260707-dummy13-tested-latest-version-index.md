---
date: 2026-07-07
branch: claude/catalog-tested-versions-bbov8t
files_changed:
  - src/content/data/catalogCategories.ts
  - src/ui/catalog.ts
  - src/content/build/render.ts
  - public/catalog/manifest.json
  - tests/unit/catalogCategories.test.ts
---

## Human

We can mark the Dummy 13 as tested as well, but currently only at 100% scale.

## Assistant

Marked the "Dummy 13 — Complete Kit" entry print-tested with a note that the
print is verified at 100% scale only (joint clearances unproven at reduced
scale), at version 1.

**Uncovered and fixed a latent conflation bug while doing it.** Dummy 13 is a
37-*part* kit — its session stores one version entry per part, every part at
version `index: 1`, not a 37-deep history. My earlier staleness check used
`versions.length` as the "latest version", which reads 37 for this kit — so a
print tested at v1 would falsely show the amber "updated since tested" state
(37 > 1). The correct notion of latest version is **revision depth = the highest
version index**, which is 1 here.

Added `latestVersionIndex(versions)` (max `index`, falling back to length when
indices are absent) and switched both renderers to it. For the three
previously-marked single-session entries this is a no-op (their length equals
their max index: spiral/manor = 1, sdf creature = 2), so nothing about them
changes; it only corrects the multi-part case. The static renderer now reads
each version's `index` and carries a `latestVersion` on its BuiltTile.

Tests: unit cases for `latestVersionIndex` (linear history, the 37-part-all-v1
kit, empty/no-index fallback) plus a regression guard that a v1-tested 37-part
kit is not stale. Verified in the build: Dummy 13's tile shows the green
"✓ Print-tested" chip (not amber), its tooltip carries the 100%-scale note +
"Verified at version 1.", and the Print-status filter's tested count ticks to 4.
typecheck, unit, build, and the full 11-test catalog e2e all green.

Follow-up on PR #905 (same catalog-tested branch).
