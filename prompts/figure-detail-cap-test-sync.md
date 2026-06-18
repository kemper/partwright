---
date: 2026-06-18
branch: claude/kind-cerf-dikkfm
files_changed:
  - tests/unit/sdf.test.ts
---

## Human

(CI follow-up on PR #713) build-unit failed: the "caps the region count"
unit test expected 17 detail regions to throw, but the cap was just raised
16 → 24.

## Assistant

Synced the test with the new cap. The test builds N detail regions and asserts
`assertBuildOpts` throws `/at most/`; with the cap now 24, 17 regions is valid,
so it no longer threw. Bumped the count 17 → 25 (just above the new cap),
matching the test's existing hardcode-just-above-the-cap convention. All 131
sdf unit tests pass.
