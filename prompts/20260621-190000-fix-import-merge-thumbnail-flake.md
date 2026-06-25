---
title: Fix flaky import-merge thumbnail e2e test (staging gate failure)
date: 2026-06-21
---

## Human

A main → staging run failed. Can you figure out and fix?

## Assistant

Traced the failed `Gate main → staging` run (#450) to a single e2e failure in
`tests/import-merge-url.spec.ts` — "merging an imported-mesh part regenerates
its OWN thumbnail" — where `thumbs.imported` came back `undefined`. It failed on
both the initial attempt and the retry.

Reproduced locally: the test passes most of the time but fails intermittently
(`--repeat-each=5` reliably reproduced one failure), confirming a flake rather
than a real regression in product code.

Root cause: the merge flow (`importValidatedSession` → `importSessionPartsIntoActive`
in `src/main.ts`/`sessionManager.ts`) regenerates the merged part's thumbnail
**asynchronously** — an inline capture on the freshly-selected part plus a
fire-and-forget `void backfillThumbnailsForParts(...)`. The test waited only for
`listParts().length === 2`, which resolves the moment the parts are copied in —
*before* either thumbnail path completes — then immediately exported and read the
thumbnail. The export occasionally raced ahead of the backfill and saw `undefined`.

Decision: this is a test-timing bug, not a product defect (the thumbnail does get
generated; the user briefly sees a placeholder, which is intended). Fixed by
making the test `expect.poll` on the exported thumbnail itself (15s timeout)
before asserting on it, instead of using part-count as a proxy for "thumbnail
ready." Verified with `--repeat-each=8` (8/8 green) and the full spec file.
