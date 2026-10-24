---
session: "01BsPPSVZ2oFGFXTxRyBtu1M"
timestamp: "2026-10-24T01:33:49Z"
tools: [vitest]
---

## Human

Merge the seven Tsubasa follow-up PRs in order.

## Assistant

## Key decisions

**Fix the parity test's fixed window rather than add entries.** After #1074, #1076, #1077 and #1078 merged, `main` went red on `apiParity.test.ts`: "API members missing from help(): getAnnotationFontSize, restoreAnnotationView".

Those methods do have `help()` rows. The test sliced only the first 60 000 characters of the `help()` methods table, and the merged PRs' new rows pushed it to about 60 900 characters, so the last entries fell outside the window.

The test now reads up to the table's closing `};`, so it can't silently truncate again. This commit lands with #1081 and fixes `main` as soon as #1081 merges.
