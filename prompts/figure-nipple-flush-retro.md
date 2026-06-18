---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - retros/inbox/20260618-figure-nipple-flush-rebake.md
---

## Human

(close-out of the flush-nipple session) Run /retro and reconcile discoveries
before ending.

## Assistant

Dropped a 4-Ls retro for the flush-by-construction nipple fix + 9-figure
rebake. Key durable takeaways: (1) deleting a fragile tunable offset by carving
from the actual surface beat tuning it; (2) the catalog has no source↔bake
freshness check and 7 figures are orphaned from `bake-manifest.json`, so stale
bakes ship silently — filed as #732; (3) a cap constant and its unit-test
threshold are coupled (the `MAX_DETAIL_REGIONS` bump broke `caps the region
count` in CI). Filed the catalog-drift gap as issue #732.
