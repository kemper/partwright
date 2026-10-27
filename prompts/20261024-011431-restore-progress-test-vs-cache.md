---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T01:14:31Z"
tools: [playwright]
---

## Human

Merge the seven Tsubasa follow-up PRs in order.

## Assistant

## Key decisions

**Keep #1082's restore-progress test meaningful under the new paint cache.** While this was being reviewed, #1082 landed on main with a test that reloads a smooth-painted version and expects the "Restoring paint" step progress.

This branch adds a local content-keyed cache that makes exactly that reload instant, so no rebuild and no progress modal, and the test failed after merging main. Both behaviours are correct. The test now sets `renderer.paintRefineCacheMaxMB` to 0, so it still exercises a real rebuild. The cache hit itself is covered by `part-boundary-paint.spec.ts`.
